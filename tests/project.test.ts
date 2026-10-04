import { describe, expect, it } from 'vitest';
import {
  Store,
  id,
  now,
  exportProject,
  validateProject,
  previewProject,
  importProject,
  recoveryProject,
  listRecoverySnapshots,
} from '@acc/db';
import { projectChecksum } from '../packages/db/src/project';
import { DEFAULT_BUDGET, type ContextSet, type ProjectFile } from '@acc/domain';
import { compileContext } from '@acc/context-compiler';
import { createApp } from '../apps/api/src/app';
import { DemoProvider } from '@acc/model-gateway';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function populated() {
  const store = new Store(':memory:');
  const root = store.createConversation('备份测试');
  const set: ContextSet = {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: root.conversation.id,
    current_node_id: root.node.id,
    target_turn_id: null,
    prompt_text: '记住中文和 emoji',
    selected_node_ids: [],
    pinned_node_ids: [],
    excluded_node_ids: [],
    budget: DEFAULT_BUDGET,
    policy_version: 'context-policy-0.1',
    graph_snapshot_version: store.workspace().revision,
    status: 'compiled',
    created_at: now(),
  };
  store.saveContext(set, compileContext(store.snapshot(), set));
  const first = store.beginAnswer(set.id, 'demo', 'demo-model');
  store.finishAnswer(first.turn.id, {
    answer: 'Alpha 🌱 Beta',
    used_source_ids: [],
    suggested_graph_updates: [],
  });
  const block = store.snapshot().blocks.find((b) => b.turn_id === first.turn.id)!;
  const e = store.createExcerpt({
    source_block_id: block.id,
    source_content_hash: block.content_hash,
    selector: { type: 'text_range', start_char: 6, end_char: 8, exact: '🌱' },
    branch: true,
  });
  const branchSet: ContextSet = {
    ...set,
    id: id(),
    conversation_id: e.branch!.conversation.id,
    current_node_id: e.branch!.node.id,
    prompt_text: '从 emoji 分支',
    graph_snapshot_version: store.workspace().revision,
  };
  store.saveContext(branchSet, compileContext(store.snapshot(), branchSet));
  const second = store.beginAnswer(branchSet.id, 'demo', 'demo-model');
  store.finishAnswer(second.turn.id, {
    answer: '来自原文的分支回答',
    used_source_ids: [e.excerpt.id],
    suggested_graph_updates: [],
  });
  return store;
}
function resign(project: ProjectFile) {
  const { checksum: _checksum, ...payload } = project;
  void _checksum;
  project.checksum = projectChecksum(payload);
  return project;
}

describe('native project packages', () => {
  it('upgrades an existing v1 database without changing graph data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-migration-'));
    const path = join(dir, 'v1.sqlite');
    let store = new Store(path);
    try {
      store.createConversation('existing data');
      const before = store.snapshot();
      store.db.exec(
        'DROP TABLE recovery_snapshots; DELETE FROM schema_migrations WHERE version = 2;',
      );
      store.close();
      store = new Store(path);
      expect(store.snapshot()).toEqual(before);
      expect(listRecoverySnapshots(store)).toEqual([]);
      expect(
        store.db
          .prepare('SELECT version FROM schema_migrations ORDER BY version')
          .all()
          .map((row) => row.version),
      ).toEqual([1, 2]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('round-trips all identities, provenance and immutable input packages and keeps a recovery copy', () => {
    const source = populated();
    const target = new Store(':memory:');
    try {
      const previous = target.createConversation('导入前的内容');
      const file = exportProject(source);
      const original = source.snapshot();
      const preview = previewProject(target, file);
      expect(preview.counts).toEqual({
        conversations: 2,
        turns: 4,
        excerpts: 1,
        nodes: 3,
        contexts: 2,
      });
      const result = importProject(target, file, preview.current);
      const restored = target.snapshot();
      expect(restored.excerpts).toEqual(original.excerpts);
      expect(restored.packages).toEqual(original.packages);
      expect(restored.nodes).toEqual(original.nodes);
      expect(restored.edges).toEqual(original.edges);
      expect(restored.turns.map((t) => t.id).sort()).toEqual(
        original.turns.map((t) => t.id).sort(),
      );
      expect(restored.workspace.id).toBe(original.workspace.id);
      expect(restored.workspace.revision).toBeGreaterThan(original.workspace.revision);
      const backup = recoveryProject(target, result.recovery_id);
      expect(backup.snapshot.conversations[0].id).toBe(previous.conversation.id);
      importProject(target, backup, previewProject(target, backup).current);
      expect(target.snapshot().conversations.map((c) => c.id)).toEqual([previous.conversation.id]);
      expect(listRecoverySnapshots(target)).toHaveLength(2);
      expect(validateProject(exportProject(target)).warnings).toEqual([]);
    } finally {
      source.close();
      target.close();
    }
  });
  it('rejects checksum errors and re-signed invalid references without touching existing data', () => {
    const source = populated();
    const target = new Store(':memory:');
    try {
      target.createConversation('keep');
      const before = target.snapshot();
      const file = exportProject(source);
      const damaged = structuredClone(file);
      damaged.snapshot.blocks[0].text_content = 'damaged';
      expect(() => validateProject(damaged)).toThrow('完整性');
      const missing = structuredClone(file);
      missing.snapshot.excerpts[0].source_block_id = 'not-found';
      resign(missing);
      expect(() => importProject(target, missing, previewProject(target, file).current)).toThrow(
        '摘录',
      );
      const cycle = structuredClone(file);
      cycle.snapshot.turns[0].parent_turn_id = cycle.snapshot.turns[1].id;
      resign(cycle);
      expect(() => validateProject(cycle)).toThrow('父消息');
      const changedPackage = structuredClone(file);
      changedPackage.snapshot.packages[1].items[0].content = 'substituted';
      resign(changedPackage);
      expect(() => validateProject(changedPackage)).toThrow('来源不一致');
      expect(target.snapshot()).toEqual(before);
      expect(listRecoverySnapshots(target)).toHaveLength(0);
    } finally {
      source.close();
      target.close();
    }
  });
  it('rejects unsupported fields/assets and duplicate IDs instead of dropping data', () => {
    const source = populated();
    try {
      const file = exportProject(source);
      expect(() => validateProject({ ...file, assets: [{ path: '../../outside' }] })).toThrow(
        '格式',
      );
      const extra = structuredClone(file) as unknown as {
        snapshot: { workspace: { settings: Record<string, unknown> } };
      };
      extra.snapshot.workspace.settings.future_field = 'must not silently disappear';
      expect(() => validateProject(extra)).toThrow('无法保留');
      const duplicate = structuredClone(file);
      duplicate.snapshot.nodes[0].id = duplicate.snapshot.conversations[0].id;
      resign(duplicate);
      expect(() => validateProject(duplicate)).toThrow('重复 ID');
    } finally {
      source.close();
    }
  });
  it('rolls back replacement and the recovery record if any write fails', () => {
    const source = populated();
    const target = new Store(':memory:');
    try {
      target.createConversation('keep');
      const before = target.snapshot();
      const file = exportProject(source);
      const expected = previewProject(target, file).current;
      target.db.exec(
        "CREATE TRIGGER reject_import BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'injected import failure'); END;",
      );
      expect(() => importProject(target, file, expected)).toThrow('injected import failure');
      expect(target.snapshot()).toEqual(before);
      expect(listRecoverySnapshots(target)).toHaveLength(0);
    } finally {
      source.close();
      target.close();
    }
  });
  it('rejects a stale preview even when only geometry changed', () => {
    const source = populated();
    const target = new Store(':memory:');
    try {
      const existing = target.createConversation('keep');
      const file = exportProject(source);
      const expected = previewProject(target, file).current;
      target.saveNode({ ...existing.node, x: 999 });
      expect(() => importProject(target, file, expected)).toThrow('已变化');
      expect(target.snapshot().nodes[0].x).toBe(999);
    } finally {
      source.close();
      target.close();
    }
  });
  it('requires explicit confirmation at the API boundary', async () => {
    const source = populated();
    const target = new Store(':memory:');
    const app = createApp(target, new DemoProvider());
    try {
      const project = exportProject(source);
      const preview = (
        await app.inject({ method: 'POST', url: '/api/project/validate', payload: { project } })
      ).json();
      expect(preview.counts.excerpts).toBe(1);
      const expected = {
        workspace_id: preview.current.workspace_id,
        revision: preview.current.revision,
        snapshot_hash: preview.current.snapshot_hash,
      };
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/project/import',
            payload: { project, expected },
          })
        ).statusCode,
      ).toBe(400);
      const imported = await app.inject({
        method: 'POST',
        url: '/api/project/import',
        payload: { project, expected, confirm_replace: true },
      });
      expect(imported.statusCode).toBe(200);
      const exported = await app.inject({ method: 'GET', url: '/api/project/export' });
      expect(exported.headers['content-disposition']).toContain('attachment;');
      expect(validateProject(exported.json()).project.snapshot.excerpts).toHaveLength(1);
    } finally {
      await app.close();
      source.close();
      target.close();
    }
  });
  it('refuses export and replacement while an answer is still generating', () => {
    const source = populated();
    const target = populated();
    try {
      const incoming = exportProject(source);
      const snapshot = target.snapshot();
      const previous = snapshot.context_sets[0];
      const ctx: ContextSet = {
        ...previous,
        id: id(),
        target_turn_id: null,
        status: 'compiled',
        prompt_text: 'still generating',
        graph_snapshot_version: snapshot.workspace.revision,
      };
      target.saveContext(ctx, compileContext(snapshot, ctx));
      target.beginAnswer(ctx.id, 'demo', 'demo-model');
      const before = target.snapshot();
      const expected = previewProject(target, incoming).current;
      expect(() => exportProject(target)).toThrow('生成结束');
      expect(() => importProject(target, incoming, expected)).toThrow('生成结束');
      expect(target.snapshot()).toEqual(before);
      expect(listRecoverySnapshots(target)).toEqual([]);
    } finally {
      source.close();
      target.close();
    }
  });
});

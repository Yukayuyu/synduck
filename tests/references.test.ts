import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Store,
  exportProject,
  validateProject,
  contentHash,
  importProject,
  previewProject,
} from '@acc/db';
import { DEFAULT_BUDGET } from '@acc/domain';
import { DemoProvider } from '@acc/model-gateway';
import { createApp } from '../apps/api/src/app';
import { documentPdf, documentDocx } from './helpers/references';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'canvas-reference-'));
  const path = join(home, 'workspace.sqlite');
  const store = new Store(path);
  const app = createApp(store, new DemoProvider());
  cleanup.push(async () => {
    await app.close();
    store.close();
    await rm(home, { recursive: true, force: true });
  });
  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: '/api' + url, payload });
  return { app, store, post, path };
}
describe('canvas reference documents', () => {
  it('imports exact text once, never includes it implicitly, and preserves sealed input, picks and restart', async () => {
    const { post, store, path } = await fixture();
    const input = {
      request_id: crypto.randomUUID(),
      title: '規格',
      text: '第一段🙂\r\n\r\n必須保留所有來源。',
    };
    const ref = (await post('/references', input)).json();
    expect(ref.node.ref_type).toBe('turn');
    expect(ref.block.text_content).toBe(input.text);
    expect((await post('/references', input)).json().node.id).toBe(ref.node.id);
    const root = (await post('/conversations', { title: '使用文件' })).json();
    const compile = async (ids: string[], budget = 16384) =>
      (
        await post('/compile', {
          conversation_id: root.conversation.id,
          prompt: '請解釋規格',
          selected_node_ids: ids,
          budget: { ...DEFAULT_BUDGET, target_context_tokens: budget },
        })
      ).json().package;
    expect((await compile([])).items).toHaveLength(0);
    const pkg = await compile([ref.node.id]);
    expect(pkg.items[0]).toMatchObject({
      content: input.text,
      actor: 'tool',
      source_block_id: ref.block.id,
      state: 'reference',
    });
    expect((await compile([ref.node.id], 8)).sendable).toBe(false);
    const exact = '必須保留所有來源。',
      start = input.text.indexOf(exact);
    const picked = (
      await post('/excerpts', {
        source_block_id: ref.block.id,
        source_content_hash: ref.block.content_hash,
        selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
        branch: true,
      })
    ).json();
    expect(picked.excerpt.snapshot_text).toBe(exact);
    const branch = (
      await post('/compile', {
        conversation_id: picked.branch.conversation.id,
        prompt: '針對這一句',
        selected_node_ids: [],
      })
    ).json().package;
    expect(branch.items.map((item: { content: string }) => item.content)).toEqual([exact]);
    const other = (await post('/canvases', { name: 'Other reference canvas' })).json();
    const cross = await post('/canvases/' + other.id + '/references', {
      request_id: crypto.randomUUID(),
      source_block_id: ref.block.id,
      source_content_hash: ref.block.content_hash,
      selector: { type: 'text_range', start_char: start, end_char: start + exact.length, exact },
      branch: false,
    });
    expect(cross.statusCode, cross.body).toBe(200);
    expect(cross.json().excerpt.external_origin.source_block_id).toBe(ref.block.id);
    store.setNodeDeleted(ref.node.id, true);
    expect((await compile([ref.node.id])).items).toHaveLength(0);
    expect(store.snapshot().packages.find((p) => p.package_id === pkg.package_id)).toEqual(pkg);
    store.setNodeDeleted(ref.node.id, false);
    expect(() =>
      store.saveBlock({
        ...ref.block,
        text_content: 'changed',
        content_hash: contentHash('changed'),
      }),
    ).toThrow('參考原文不可覆寫');
    const backup = exportProject(store);
    expect(validateProject(backup).project).toEqual(backup);
    const imported = new Store(':memory:');
    importProject(imported, backup, previewProject(imported, backup).current);
    expect(imported.snapshot().blocks.find((b) => b.id === ref.block.id)).toEqual(ref.block);
    imported.close();
    const restored = new Store(path);
    expect(restored.snapshot().blocks.find((b) => b.id === ref.block.id)?.content_hash).toBe(
      contentHash(input.text),
    );
    restored.close();
  }, 15000);
  it('places references at requested free coordinates and uses their full width to avoid existing cards', async () => {
    const { post, store } = await fixture();
    const obstacle = (
      await post('/conversations', { title: 'Keep this position', position: { x: 400, y: 100 } })
    ).json().node;
    const ref = (
      await post('/references', {
        request_id: crypto.randomUUID(),
        title: 'Nearby reference',
        text: 'No overlap.',
        position: { x: 0, y: 100 },
      })
    ).json().node;
    expect(ref.width).toBe(420);
    expect(ref.x).toBe(0);
    expect(ref.y).toBeGreaterThanOrEqual(obstacle.y + obstacle.height);
    expect(store.snapshot().nodes.find((node) => node.id === obstacle.id)).toEqual(obstacle);
    const free = (
      await post('/references', {
        request_id: crypto.randomUUID(),
        title: 'Free location',
        text: 'Exact coordinates.',
        position: { x: -2100.5, y: -1400.25 },
      })
    ).json().node;
    expect({ x: free.x, y: free.y }).toEqual({ x: -2100.5, y: -1400.25 });
  });
  it('extracts real PDF and DOCX locally with original file identity and keeps invalid documents atomic', async () => {
    const { post, store } = await fixture();
    for (const [name, bytes, expected] of [
      ['sample.pdf', documentPdf(), 'Reference file evidence.'],
      ['sample.docx', documentDocx(), 'Word 文件🙂'],
    ] as const) {
      const r = await post('/references', {
        request_id: crypto.randomUUID(),
        title: name,
        file: { name, data: bytes.toString('base64') },
      });
      expect(r.statusCode, r.body).toBe(200);
      const ref = r.json();
      expect(ref.block.text_content).toContain(expected);
      expect(ref.block.structured_data.reference.original_bytes).toBe(bytes.length);
    }
    const before = store.snapshot();
    for (const name of ['broken.pdf', 'broken.docx', 'unsafe.exe']) {
      const r = await post('/references', {
        request_id: crypto.randomUUID(),
        title: name,
        file: { name, data: Buffer.from('broken').toString('base64') },
      });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(store.snapshot()).toEqual(before);
  }, 30000);
  it('rejects binary, oversized, unsupported or forged input without creating nodes', async () => {
    const { post, store } = await fixture();
    for (const extra of [
      { text: '\0binary' },
      { text: '🙂'.repeat(300000) },
      { text: '  ' },
      { file: { name: 'bad.txt', data: Buffer.from([255, 254, 255]).toString('base64') } },
      { text: 'ok', metadata: { kind: 'file' } },
    ]) {
      const r = await post('/references', {
        request_id: crypto.randomUUID(),
        title: 'invalid',
        ...extra,
      });
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect(store.snapshot().nodes).toHaveLength(0);
  });
});

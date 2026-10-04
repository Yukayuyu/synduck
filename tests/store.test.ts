import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '@acc/db';

describe('SQLite provenance', () => {
  it('persists exact excerpts and branches across reopening without altering source turns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-'));
    const path = join(dir, 'test.sqlite');
    let store = new Store(path);
    try {
      const c = store.createConversation('研究');
      store.appendTurn(c.conversation.id, 'human', '你好 🌱，上下文要可追溯。');
      const original = store.snapshot();
      const b = original.blocks[0];
      const result = store.createExcerpt({
        source_block_id: b.id,
        source_content_hash: b.content_hash,
        selector: { type: 'text_range', start_char: 3, end_char: 5, exact: '🌱' },
        branch: true,
      });
      expect(result.branch?.conversation.branch_origin_excerpt_id).toBe(result.excerpt.id);
      expect(store.snapshot().turns).toEqual(original.turns);
      expect(store.snapshot().edges.map((e) => e.type)).toEqual(['excerpt_from', 'branch_from']);
      store.close();
      store = new Store(path);
      expect(store.snapshot().excerpts[0].selector.exact).toBe('🌱');
      expect(store.snapshot().conversations).toHaveLength(2);
      expect(store.db.prepare('SELECT * FROM schema_migrations').all()).toHaveLength(2);
      expect(() => store.db.prepare('DELETE FROM content_blocks WHERE id=?').run(b.id)).toThrow();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects stale selection and rolls back the entire branch command on failure', () => {
    const store = new Store(':memory:');
    try {
      const c = store.createConversation('研究');
      store.appendTurn(c.conversation.id, 'human', 'source text');
      const initial = store.snapshot();
      const b = initial.blocks[0];
      expect(() =>
        store.createExcerpt({
          source_block_id: b.id,
          source_content_hash: b.content_hash,
          selector: { type: 'text_range', start_char: 0, end_char: 6, exact: 'WRONG!' },
          branch: true,
        }),
      ).toThrow();
      expect(store.snapshot()).toEqual(initial);
      store.db.exec(
        "CREATE TRIGGER reject_branch BEFORE INSERT ON edges WHEN json_extract(NEW.payload, '$.type') = 'branch_from' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
      );
      expect(() =>
        store.createExcerpt({
          source_block_id: b.id,
          source_content_hash: b.content_hash,
          selector: { type: 'text_range', start_char: 0, end_char: 6, exact: 'source' },
          branch: true,
        }),
      ).toThrow('injected failure');
      expect(store.snapshot()).toEqual(initial);
    } finally {
      store.close();
    }
  });
});

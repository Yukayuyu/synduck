import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

describe('required runtime', () => {
  it('supports SQLite transactions and foreign keys', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        'PRAGMA foreign_keys = ON; CREATE TABLE parents(id TEXT PRIMARY KEY); CREATE TABLE children(parent_id TEXT REFERENCES parents(id));',
      );
      expect(() => db.prepare('INSERT INTO children VALUES (?)').run('missing')).toThrow();
      db.exec("BEGIN; INSERT INTO parents VALUES ('p'); ROLLBACK;");
      expect(db.prepare('SELECT * FROM parents').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});

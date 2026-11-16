import { describe, expect, it } from 'vitest';
import { modelInput, SUMMARY_PROMPT, type ContextPackage } from '@acc/domain';
import { contextCases, grade, runContextEval, summarize } from '../evals/context-cases';

const reply = (pkg: ContextPackage, answer: string) => ({
  answer,
  used_source_ids: pkg.items.map((i) => i.source_id),
  suggested_graph_updates: [],
});

describe('context evaluation harness', () => {
  it('builds sendable variants that differ only in the feature under test', async () => {
    for (const test of contextCases) {
      const variants = await test.prepare(async (pkg) => reply(pkg, 'The cap is 4200 euros.'));
      expect(variants).toHaveLength(2);
      for (const variant of variants) expect(variant.pkg.sendable, test.name).toBe(true);
      const [first, second] = variants;
      expect(first.pkg.current_prompt).toBe(second.pkg.current_prompt);
      if (second.name === 'flat') {
        expect(JSON.parse(modelInput(first.pkg)).threads.length).toBeGreaterThan(0);
        expect(Object.keys(JSON.parse(modelInput(second.pkg)))).toEqual([
          'current_prompt',
          'context',
          'conflicts',
        ]);
        // Same sources either way; only the relationship metadata and order differ.
        expect(second.pkg.items.map((i) => i.source_id).sort()).toEqual(
          first.pkg.items.map((i) => i.source_id).sort(),
        );
      } else {
        expect(first.pkg.items.some((i) => i.compressed)).toBe(true);
        expect(second.pkg.items.some((i) => i.compressed)).toBe(false);
        expect(modelInput(second.pkg)).not.toContain('4200');
      }
    }
  });
  it('keeps the sibling branch and unpicked titles out of every variant', async () => {
    const sibling = contextCases.find((c) => c.name === 'sibling-unknown')!;
    for (const variant of await sibling.prepare(async (pkg) => reply(pkg, 'x')))
      expect(modelInput(variant.pkg)).not.toContain('May 9');
    const merged = contextCases.find((c) => c.name === 'attribute-merged-views')!;
    const [chain, flat] = await merged.prepare(async (pkg) => reply(pkg, 'x'));
    expect(modelInput(chain.pkg)).toContain('Release review B');
    expect(modelInput(flat.pkg)).not.toContain('Release review B');
  });
  it('grades answers and reports pass counts, errors included', async () => {
    expect(grade({ expect: [/heron/i], forbid: [/falcon/i] }, 'Heron')).toBe(true);
    expect(grade({ expect: [/heron/i], forbid: [/falcon/i] }, 'Falcon, then Heron')).toBe(false);
    let calls = 0;
    const results = await runContextEval(async (pkg) => {
      calls++;
      if (pkg.current_prompt === SUMMARY_PROMPT) return reply(pkg, 'Budget cap: 4200 euros.');
      if (pkg.current_prompt.includes('codename')) throw new Error('model unavailable');
      // A scripted stand-in: answers from whatever text it was actually given.
      const input = modelInput(pkg);
      const answer = pkg.current_prompt.includes('budget cap')
        ? input.includes('4200')
          ? '4200'
          : 'UNKNOWN'
        : pkg.current_prompt.includes('June')
          ? input.includes('Release review B')
            ? 'Release review B'
            : 'UNKNOWN'
          : pkg.current_prompt.includes('database')
            ? 'SQLite'
            : 'UNKNOWN';
      return reply(pkg, answer);
    }, 2);
    const rows = Object.fromEntries(
      summarize(results).map((row) => [`${row.case}/${row.variant}`, `${row.passed}/${row.total}`]),
    );
    expect(rows).toEqual({
      'nested-override/chain': '0/2',
      'nested-override/flat': '0/2',
      'attribute-merged-views/chain': '2/2',
      'attribute-merged-views/flat': '0/2',
      'branch-overrides-parent/chain': '2/2',
      'branch-overrides-parent/flat': '2/2',
      'sibling-unknown/chain': '2/2',
      'sibling-unknown/flat': '2/2',
      'summary-recall/summary': '2/2',
      'summary-recall/truncated': '0/2',
    });
    expect(results.filter((r) => r.error).every((r) => r.error === 'model unavailable')).toBe(true);
    expect(calls).toBe(21);
  });
});

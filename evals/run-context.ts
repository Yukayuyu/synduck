import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry } from '../packages/model-gateway/src/registry';
import { contextCases, runContextEval, summarize } from './context-cases';

// Runs the context-chain and summary cases against the configured real model and
// reports pass counts per variant. It uses the same model settings as the app.
const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const repeat = Math.max(1, Math.min(20, Number(value('--repeat') ?? 3) || 3));
const only = value('--case');
const models = new ProviderRegistry(
  process.env.MODEL_SETTINGS_PATH || './data/model-settings.json',
);
if (models.name === 'demo' && !args.includes('--allow-demo')) {
  console.error(
    'The demo provider does not call a model, so it cannot measure answer quality.\n' +
      'Sign in to ChatGPT / Codex in the app, or set LLM_PROVIDER=openai with LLM_MODEL and\n' +
      'LLM_API_KEY in .env, then run again. Use --allow-demo only to check that the harness runs.',
  );
  process.exit(2);
}
const cases = contextCases.filter((test) => !only || test.name === only);
if (cases.length === 0) {
  console.error(`No case named ${only}. Available: ${contextCases.map((c) => c.name).join(', ')}`);
  process.exit(2);
}
console.log(
  `Model: ${models.name} / ${models.model || 'unconfigured'} · ${cases.length} cases · ${repeat} runs per variant`,
);
const results = await runContextEval((pkg) => models.generate(pkg), repeat, cases);
const rows = summarize(results);
console.table(
  rows.map((row) => ({
    case: row.case,
    variant: row.variant,
    passed: `${row.passed}/${row.total}`,
  })),
);
const errors = results.filter((result) => result.error);
if (errors.length > 0)
  console.log(`${errors.length} runs ended in an error; see the report for messages.`);
const directory = 'eval-output';
mkdirSync(directory, { recursive: true });
const path = join(directory, `context-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(
  path,
  JSON.stringify(
    {
      provider: models.name,
      model: models.model,
      repeat,
      cases: cases.map(({ name, measures }) => ({ name, measures })),
      summary: rows,
      results,
    },
    null,
    2,
  ),
);
console.log(`Report with every answer: ${path}`);
await models.close();
process.exit(0);

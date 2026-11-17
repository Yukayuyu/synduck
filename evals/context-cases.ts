import { randomUUID } from 'node:crypto';
import { Store, id, now } from '@acc/db';
import { compileContext, compileSummaryInput } from '@acc/context-compiler';
import {
  DEFAULT_BUDGET,
  SUMMARY_PROMPT,
  type Answer,
  type ContextPackage,
  type ContextSet,
} from '@acc/domain';

// Every case builds a real workspace and compiles it with the production compiler.
// The texts are synthetic; nothing here comes from a user's canvas.
export interface EvalVariant {
  name: string;
  pkg: ContextPackage;
}
export interface EvalCase {
  name: string;
  measures: string;
  // The answer must match every `expect` pattern and none of the `forbid` patterns.
  expect: RegExp[];
  forbid: RegExp[];
  prepare(generate: (pkg: ContextPackage) => Promise<Answer>): Promise<EvalVariant[]>;
}

function contextSet(
  store: Store,
  conversationId: string,
  prompt: string,
  extra: Partial<ContextSet> = {},
): ContextSet {
  return {
    id: id(),
    workspace_id: store.workspace().id,
    conversation_id: conversationId,
    current_node_id: store
      .snapshot()
      .nodes.find((n) => n.ref_type === 'conversation' && n.ref_id === conversationId)!.id,
    target_turn_id: null,
    prompt_text: prompt,
    selected_node_ids: [],
    pinned_node_ids: [],
    excluded_node_ids: [],
    budget: DEFAULT_BUDGET,
    policy_version: 'context-policy-0.1',
    graph_snapshot_version: store.workspace().revision,
    status: 'compiled',
    created_at: now(),
    ...extra,
  };
}
// The input as it was before context chains: no thread list, no thread IDs, score order.
export function flat(pkg: ContextPackage): ContextPackage {
  return {
    ...pkg,
    threads: undefined,
    items: pkg.items.map(({ thread_id: _thread, ...item }) => item),
  };
}
const chainAndFlat = (pkg: ContextPackage): EvalVariant[] => [
  { name: 'chain', pkg },
  { name: 'flat', pkg: flat(pkg) },
];
function withStore<T>(build: (store: Store) => T): T {
  const store = new Store(':memory:');
  try {
    return build(store);
  } finally {
    store.close();
  }
}
const say = (store: Store, conversationId: string, text: string) =>
  store.appendTurn(conversationId, 'human', text);
const fork = (store: Store, conversationId: string, prompt: string) =>
  store.createForks({
    conversation_id: conversationId,
    branches: [{ request_id: id(), mode: 'fork', prompt }],
  })[0];

export const contextCases: EvalCase[] = [
  {
    name: 'nested-override',
    measures: 'Follows the order of a three-level fork: the nearer ancestor overrides the root.',
    expect: [/heron/i],
    forbid: [/falcon/i],
    prepare: async () =>
      withStore((store) => {
        const root = store.createConversation('Project kickoff');
        say(store, root.conversation.id, 'The project codename is Falcon.');
        const middle = fork(store, root.conversation.id, 'Naming review');
        say(
          store,
          middle.conversation.id,
          'Legal rejected the earlier codename. From now on the codename is Heron.',
        );
        const leaf = fork(store, middle.conversation.id, 'Launch checklist');
        say(store, leaf.conversation.id, 'Prepare the launch checklist header.');
        return chainAndFlat(
          compileContext(
            store.snapshot(),
            contextSet(
              store,
              leaf.conversation.id,
              'Which codename goes in the checklist header? Answer with the single current codename.',
            ),
          ),
        );
      }),
  },
  {
    name: 'attribute-merged-views',
    measures: 'Attributes each viewpoint to the conversation it came from when two are merged.',
    expect: [/release review b/i],
    forbid: [/release review a/i],
    prepare: async () =>
      withStore((store) => {
        const a = store.createConversation('Release review A');
        say(store, a.conversation.id, 'Recommendation: ship in March, accept the known issues.');
        const b = store.createConversation('Release review B');
        say(store, b.conversation.id, 'Recommendation: ship in June, after the audit completes.');
        const asker = store.createConversation('Decision memo');
        return chainAndFlat(
          compileContext(
            store.snapshot(),
            contextSet(
              store,
              asker.conversation.id,
              'Which conversation recommends shipping in June? Answer with only its title. If the titles are not available to you, answer UNKNOWN.',
              { selected_node_ids: [a.node.id, b.node.id] },
            ),
          ),
        );
      }),
  },
  {
    name: 'branch-overrides-parent',
    measures: 'Prefers a later decision in the current branch over inherited background.',
    expect: [/sqlite/i],
    forbid: [],
    prepare: async () =>
      withStore((store) => {
        const root = store.createConversation('Architecture');
        say(store, root.conversation.id, 'Decision: the database is PostgreSQL.');
        const branch = fork(store, root.conversation.id, 'Offline mode');
        say(
          store,
          branch.conversation.id,
          'For offline mode this branch switches the database to SQLite.',
        );
        return chainAndFlat(
          compileContext(
            store.snapshot(),
            contextSet(
              store,
              branch.conversation.id,
              'Which database does this branch use now? Answer with one word.',
            ),
          ),
        );
      }),
  },
  {
    name: 'sibling-unknown',
    measures: 'Admits that a sibling branch is not visible instead of guessing its content.',
    expect: [/unknown/i],
    forbid: [/may 9/i],
    prepare: async () =>
      withStore((store) => {
        const root = store.createConversation('Planning');
        say(store, root.conversation.id, 'We need to settle a launch date.');
        const mine = fork(store, root.conversation.id, 'Marketing plan');
        const sibling = fork(store, root.conversation.id, 'Date discussion');
        say(store, sibling.conversation.id, 'The launch date is May 9.');
        say(store, mine.conversation.id, 'Draft the announcement outline.');
        return chainAndFlat(
          compileContext(
            store.snapshot(),
            contextSet(
              store,
              mine.conversation.id,
              'What launch date did the other branch settle on? If you cannot see it, answer UNKNOWN.',
            ),
          ),
        );
      }),
  },
  {
    name: 'general-knowledge',
    measures: 'Uses its own knowledge when the thread does not contain the answer.',
    expect: [/4[,.]?096/],
    forbid: [],
    prepare: async () =>
      withStore((store) => {
        const thread = store.createConversation('Storage choice');
        say(store, thread.conversation.id, 'We store every canvas in a single SQLite file.');
        return chainAndFlat(
          compileContext(
            store.snapshot(),
            contextSet(
              store,
              thread.conversation.id,
              "What is SQLite's default database page size in bytes for new databases? Answer with the number.",
            ),
          ),
        );
      }),
  },
  {
    name: 'summary-recall',
    measures: 'Recalls an early fact from a long conversation through a background summary.',
    expect: [/4[,.]?200/],
    forbid: [],
    prepare: async (generate) => {
      const store = new Store(':memory:');
      try {
        const thread = store.createConversation('Budget planning');
        const filler = 'We also discussed venue options and catering in general terms. '.repeat(18);
        say(store, thread.conversation.id, `The total budget cap is 4200 euros. ${filler}`);
        for (const topic of ['venue', 'catering', 'transport', 'printing', 'signage'])
          say(store, thread.conversation.id, `Notes on ${topic}: ${filler}`);
        const budget = { ...DEFAULT_BUDGET, target_context_tokens: 3000 };
        const question =
          'What is the total budget cap? Answer with the number, or UNKNOWN if it is not available.';
        const truncated = compileContext(
          store.snapshot(),
          contextSet(store, thread.conversation.id, question, { budget }),
        );
        const set = contextSet(store, thread.conversation.id, SUMMARY_PROMPT, {
          id: `summary-${randomUUID()}`,
          budget: {
            max_input_tokens: 128000,
            reserved_output_tokens: 8000,
            target_context_tokens: 64000,
          },
        });
        const input = compileSummaryInput(store.snapshot(), set);
        const { turn } = store.beginSummary(set, input, 'eval', 'eval');
        store.finishSummary(turn.id, await generate(input));
        const summarized = compileContext(
          store.snapshot(),
          contextSet(store, thread.conversation.id, question, { budget }),
        );
        return [
          { name: 'summary', pkg: summarized },
          { name: 'truncated', pkg: truncated },
        ];
      } finally {
        store.close();
      }
    },
  },
];

export interface EvalResult {
  case: string;
  variant: string;
  run: number;
  passed: boolean;
  answer: string | null;
  error: string | null;
}
export function grade(test: Pick<EvalCase, 'expect' | 'forbid'>, answer: string) {
  return (
    test.expect.every((pattern) => pattern.test(answer)) &&
    !test.forbid.some((pattern) => pattern.test(answer))
  );
}
export async function runContextEval(
  generate: (pkg: ContextPackage) => Promise<Answer>,
  repeat = 1,
  cases: EvalCase[] = contextCases,
) {
  const results: EvalResult[] = [];
  for (const test of cases) {
    let variants: EvalVariant[];
    try {
      variants = await test.prepare(generate);
    } catch (error) {
      results.push({
        case: test.name,
        variant: 'prepare',
        run: 1,
        passed: false,
        answer: null,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    for (const variant of variants)
      for (let run = 1; run <= repeat; run++) {
        try {
          if (!variant.pkg.sendable) throw new Error('context package is not sendable');
          const { answer } = await generate(variant.pkg);
          results.push({
            case: test.name,
            variant: variant.name,
            run,
            passed: grade(test, answer),
            answer,
            error: null,
          });
        } catch (error) {
          results.push({
            case: test.name,
            variant: variant.name,
            run,
            passed: false,
            answer: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
  }
  return results;
}
export function summarize(results: EvalResult[]) {
  const rows = new Map<string, { case: string; variant: string; passed: number; total: number }>();
  for (const result of results) {
    const key = `${result.case}\u0000${result.variant}`;
    const row = rows.get(key) ?? {
      case: result.case,
      variant: result.variant,
      passed: 0,
      total: 0,
    };
    row.total++;
    if (result.passed) row.passed++;
    rows.set(key, row);
  }
  return [...rows.values()];
}

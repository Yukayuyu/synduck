import { describe, expect, it } from 'vitest';
import { OpenAIProvider, partialAnswer, validateAnswer } from '@acc/model-gateway';
import { DEFAULT_BUDGET, type ContextPackage } from '@acc/domain';

const pkg: ContextPackage = {
  package_id: 'pkg',
  context_set_id: 'ctx',
  policy_version: 'context-policy-0.1',
  current_prompt: 'why?',
  graph_snapshot_version: 1,
  items: [],
  excluded: [{ node_id: 'excluded-secret-id', source_id: null, reason: 'explicitly excluded' }],
  conflicts: [],
  diagnostics: [],
  sendable: true,
  budget: { ...DEFAULT_BUDGET, used_context_tokens: 0, estimated_input_tokens: 1000 },
  trace: { resolved_candidates: 0, included_items: 0, deduplicated_items: 0 },
};
const answer = { answer: 'Safe answer 🌱', used_source_ids: [], suggested_graph_updates: [] };
function transportFor(
  events: object[],
  inspect?: (body: Record<string, unknown>) => void,
): typeof fetch {
  return (async (_url, init) => {
    inspect?.(JSON.parse(init?.body as string));
    const bytes = new TextEncoder().encode(
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
    );
    let offset = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (offset >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(bytes.slice(offset, offset + 7));
          offset += 7;
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}
describe('server-only structured gateway', () => {
  it('streams fragmented UTF-8 SSE and sends only the inspectable package content', async () => {
    let body: Record<string, unknown> = {};
    const drafts: string[] = [];
    const provider = new OpenAIProvider(
      'test-model',
      'test-key',
      transportFor(
        [
          { type: 'response.output_text.delta', delta: JSON.stringify(answer).slice(0, 30) },
          { type: 'response.output_text.delta', delta: JSON.stringify(answer).slice(30) },
          { type: 'response.completed' },
        ],
        (value) => {
          body = value;
        },
      ),
    );
    expect(await provider.generate(pkg, (text) => drafts.push(text))).toEqual(answer);
    expect(body.store).toBe(false);
    expect(body.model).toBe('test-model');
    expect(body.input).not.toContain('excluded-secret-id');
    expect(body.input).not.toContain('test-key');
    expect(drafts.at(-1)).toBe(answer.answer);
  });
  it('rejects unprovided citations, invalid schemas and incomplete streams', async () => {
    expect(() => validateAnswer({ ...answer, used_source_ids: ['invented'] }, pkg)).toThrow();
    expect(() => validateAnswer({ answer: 'only text' }, pkg)).toThrow();
    const provider = new OpenAIProvider(
      'test-model',
      'test-key',
      transportFor([{ type: 'response.output_text.delta', delta: JSON.stringify(answer) }]),
    );
    await expect(provider.generate(pkg)).rejects.toThrow('连接中断');
  });
  it('decodes partial structured text without exposing incomplete escapes', () => {
    expect(partialAnswer('{"answer":"line\\nnext\\u4e')).toBe('line\nnext');
    expect(partialAnswer('{"answer":"line\\nnext\\u4e2d')).toBe('line\nnext中');
  });
  it('normalizes authentication failures without returning provider messages', async () => {
    const provider = new OpenAIProvider(
      'test-model',
      'test-key',
      (async () => new Response('sensitive provider details', { status: 401 })) as typeof fetch,
    );
    await expect(provider.generate(pkg)).rejects.toThrow('HTTP 401');
  });
});

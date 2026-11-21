import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AnswerSchema, answerJsonSchema } from '@acc/domain';

type Node = Record<string, unknown>;
// Rules of strict structured output (OpenAI / Codex). Claude accepts this subset too.
function strictProblems(schema: unknown, path = '$'): string[] {
  if (Array.isArray(schema))
    return schema.flatMap((child, i) => strictProblems(child, `${path}[${i}]`));
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Node;
  const problems: string[] = [];
  for (const keyword of ['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties'])
    if (keyword in node) problems.push(`${path}: ${keyword} is not supported`);
  if (node.type === 'object') {
    const keys = Object.keys((node.properties as Node | undefined) ?? {});
    if (node.additionalProperties !== false)
      problems.push(`${path}: objects must set additionalProperties: false`);
    const required = (node.required as string[] | undefined) ?? [];
    if (keys.some((key) => !required.includes(key)))
      problems.push(`${path}: every property must be required`);
  }
  for (const [key, child] of Object.entries(node))
    problems.push(...strictProblems(child, `${path}.${key}`));
  return problems;
}

describe('answer output schema', () => {
  it('stays inside the JSON Schema subset strict structured output accepts', () => {
    expect(strictProblems(answerJsonSchema())).toEqual([]);
    // The raw conversion is what broke Codex in the first 0.16.0 build.
    expect(strictProblems(z.toJSONSchema(AnswerSchema))).toContain(
      '$.properties.suggested_graph_updates.items: oneOf is not supported',
    );
  });
  it('still describes both proposal kinds and validates real answers', () => {
    const alternatives = (
      (answerJsonSchema().properties as Node).suggested_graph_updates as {
        items: { anyOf: Node[] };
      }
    ).items.anyOf;
    expect(
      alternatives.map((option) => ((option.properties as Node).type as { const: string }).const),
    ).toEqual(['summary_node', 'idea']);
    expect(
      AnswerSchema.parse({
        answer: 'ok',
        used_source_ids: [],
        suggested_graph_updates: [
          { type: 'idea', title: 'Deepen', prompt: 'Why?', reason: 'r', source_ids: [] },
        ],
      }).suggested_graph_updates,
    ).toHaveLength(1);
  });
  it('matches what the Claude SDK sends for the same answer format', () => {
    const claude = JSON.stringify(betaZodOutputFormat(AnswerSchema));
    expect(claude).not.toContain('"oneOf"');
    expect(claude).toContain('"anyOf"');
  });
});

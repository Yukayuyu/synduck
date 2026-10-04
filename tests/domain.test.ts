import { describe, expect, it } from 'vitest';
import { TextSelectorSchema, EdgeSchema, TurnSchema, ContextStateSchema } from '@acc/domain';

describe('canonical schema invariants', () => {
  it('defines precise UTF-16 selection offsets including emoji', () => {
    expect(TextSelectorSchema.parse({ type: 'text_range', start_char: 3, end_char: 5, exact: '🌱' }).exact).toBe('🌱');
    expect(TextSelectorSchema.safeParse({ type: 'text_range', start_char: 5, end_char: 3, exact: 'x' }).success).toBe(false);
    expect(TextSelectorSchema.safeParse({ type: 'text_range', start_char: 0, end_char: 5, exact: 'x' }).success).toBe(false);
  });
  it('rejects structural relations invented by AI', () => {
    const edge = { id: 'e', workspace_id: 'w', source_node_id: 'a', target_node_id: 'b', direction: 'directed', label: null, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), edge_class: 'structural', type: 'branch_from', provenance: 'ai', confidence: null, confirmed: true };
    expect(EdgeSchema.safeParse(edge).success).toBe(false);
    expect(EdgeSchema.safeParse({ ...edge, provenance: 'system' }).success).toBe(true);
  });
  it('requires context provenance on every assistant turn', () => {
    const turn = { id: 't', conversation_id: 'c', parent_turn_id: null, actor: 'assistant', sequence: 1, model_provider: 'demo', model_id: 'demo-v1', input_context_set_id: null, status: 'complete', created_at: new Date().toISOString(), used_source_ids: [], suggested_graph_updates: [], error: null };
    expect(TurnSchema.safeParse(turn).success).toBe(false);
    expect(TurnSchema.safeParse({ ...turn, input_context_set_id: 'ctx' }).success).toBe(true);
  });
  it('includes all lifecycle states', () => {
    expect(ContextStateSchema.options).toEqual(['active', 'confirmed', 'hypothesis', 'superseded', 'deprecated', 'rejected', 'reference', 'unknown']);
  });
});

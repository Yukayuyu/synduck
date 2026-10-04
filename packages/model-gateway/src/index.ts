import { z } from 'zod';
import {
  AnswerSchema,
  ANSWER_INSTRUCTIONS,
  DomainError,
  modelInput,
  type Answer,
  type ContextPackage,
} from '@acc/domain';

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  generate(pkg: ContextPackage, onDraft?: (text: string) => void): Promise<Answer>;
}

export function validateAnswer(raw: unknown, pkg: ContextPackage): Answer {
  const parsed = AnswerSchema.safeParse(raw);
  if (!parsed.success)
    throw new DomainError('invalid_model_output', '模型返回格式不符合规范，请重试。', 502);
  const ids = new Set(pkg.items.map((i) => i.source_id));
  if (
    [
      ...parsed.data.used_source_ids,
      ...parsed.data.suggested_graph_updates.flatMap((p) => p.source_ids),
    ].some((s) => !ids.has(s))
  )
    throw new DomainError('invalid_model_sources', '模型引用了未提供的来源，回答未保存。', 502);
  return parsed.data;
}

export class DemoProvider implements ModelProvider {
  readonly name = 'demo';
  readonly model = 'offline-demo-v1';
  async generate(pkg: ContextPackage, onDraft?: (text: string) => void) {
    const text = `【本地演示 · 未调用 AI】\n\n你的问题：${pkg.current_prompt}\n\n${
      pkg.items.length
        ? `本轮已包含 ${pkg.items.length} 项上下文。以下为原文引用，未做模型推理：\n\n${pkg.items.map((i, n) => `${n + 1}.「${i.content}」`).join('\n\n')}`
        : '这是一段用于体验工作流的示例文字：让上下文可见，让每个分支都保留来源。画布记录思考路径，上下文检查器显示本轮发送的内容。'
    }\n\n选中一段文字即可建立摘录，再沿着它开始新的分支。真实回答需要在服务端配置模型。`;
    // Draft events demonstrate lifecycle without pretending to be model tokens.
    for (let i = 0; i < text.length; i += 48) {
      onDraft?.(text.slice(0, i + 48));
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    return validateAnswer(
      {
        answer: text,
        used_source_ids: pkg.items.map((i) => i.source_id),
        suggested_graph_updates: [],
      },
      pkg,
    );
  }
}

// Only complete JSON string escape sequences are surfaced as transient drafts.
// The full structured response still needs validation before persistence.
export function partialAnswer(json: string): string | null {
  const match = json.match(/"answer"\s*:\s*"((?:[^"\\]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}

export class OpenAIProvider implements ModelProvider {
  readonly name = 'openai';
  constructor(
    readonly model: string,
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  async generate(pkg: ContextPackage, onDraft?: (text: string) => void): Promise<Answer> {
    if (!this.model || !this.key)
      throw new DomainError(
        'provider_not_configured',
        '请在服务端配置 LLM_MODEL 和 LLM_API_KEY。',
        503,
      );
    try {
      const response = await this.transport('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          store: false,
          stream: true,
          instructions: ANSWER_INSTRUCTIONS,
          input: modelInput(pkg),
          max_output_tokens: pkg.budget.reserved_output_tokens,
          text: {
            format: {
              type: 'json_schema',
              name: 'context_canvas_answer',
              strict: true,
              schema: z.toJSONSchema(AnswerSchema),
            },
          },
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok)
        throw new DomainError(
          'provider_error',
          `模型服务请求失败（HTTP ${response.status}），请检查服务端配置后重试。`,
          502,
        );
      if (!response.body) throw new DomainError('empty_model_output', '模型服务未返回内容。', 502);
      let pending = '';
      let output = '';
      let completed = false;
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        pending += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline).trimEnd();
          pending = pending.slice(newline + 1);
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const event = JSON.parse(line.slice(6)) as { type: string; delta?: string };
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            output += event.delta;
            if (output.length > 200000)
              throw new DomainError('oversized_model_output', '模型返回内容过大。', 502);
            const draft = partialAnswer(output);
            if (draft !== null) onDraft?.(draft);
          }
          if (event.type === 'response.completed') completed = true;
          if (
            ['error', 'response.failed', 'response.incomplete', 'response.refusal.delta'].includes(
              event.type,
            )
          )
            throw new DomainError(
              'model_incomplete',
              '模型未完成有效回答，可调整问题后重试。',
              502,
            );
        }
      }
      if (!completed) throw new DomainError('model_interrupted', '模型连接中断，回答未保存。', 502);
      return validateAnswer(JSON.parse(output), pkg);
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError('model_unavailable', '模型服务连接或格式异常，请重试。', 502);
    }
  }
}

export function configuredProvider(
  env: Record<string, string | undefined> = process.env,
): ModelProvider {
  const provider = env.LLM_PROVIDER || 'demo';
  if (provider === 'demo') return new DemoProvider();
  if (provider === 'openai')
    return new OpenAIProvider(env.LLM_MODEL || '', env.LLM_API_KEY || env.OPENAI_API_KEY || '');
  throw new DomainError('unsupported_provider', 'LLM_PROVIDER 目前支持 demo 或 openai。', 503);
}

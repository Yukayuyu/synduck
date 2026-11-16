import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import {
  AnswerSchema,
  ANSWER_INSTRUCTIONS,
  DomainError,
  modelInput,
  type Answer,
  type ContextPackage,
} from '@acc/domain';
import { partialAnswer, validateAnswer, type ModelProvider } from './index';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
// Shown when the account's model list cannot be read. IDs are complete as written.
const KNOWN_MODELS = [
  { model: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { model: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { model: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { model: 'claude-fable-5-2', name: 'Claude Fable 5.2' },
];
const ClaudeKey = z
  .string()
  .trim()
  .min(20)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);
// The slice of the SDK this provider uses, so tests can supply a stand-in.
export type ClaudeClient = Pick<Anthropic, 'beta' | 'models'>;

// Claude through the Claude API with the user's own API key. The key is kept in a
// restricted backend file (or the server environment), is never returned to the
// browser and never logged.
export class ClaudeProvider implements ModelProvider {
  readonly name = 'claude';
  private saved: string | null = null;
  constructor(
    private readonly credentialsPath: string,
    private selected: string,
    private readonly environmentKey: string = '',
    private readonly createClient: (apiKey: string) => ClaudeClient = (apiKey) =>
      new Anthropic({ apiKey }),
  ) {
    try {
      this.saved = z
        .object({ api_key: ClaudeKey })
        .parse(JSON.parse(readFileSync(credentialsPath, 'utf8'))).api_key;
    } catch (error) {
      // A damaged file is treated as signed out; connecting again replaces it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.saved = null;
    }
  }
  get model() {
    return this.selected || DEFAULT_CLAUDE_MODEL;
  }
  // Empty until the user picks one; `model` then reports the default.
  get selection() {
    return this.selected;
  }
  setModel(model: string) {
    this.selected = model;
  }
  private get key() {
    return this.saved || this.environmentKey;
  }
  status() {
    const key = this.key;
    return {
      connected: !!key,
      source: this.saved ? ('saved' as const) : key ? ('environment' as const) : null,
      key_hint: key ? key.slice(-4) : null,
      model: this.model,
    };
  }
  // Checks the key with a free model-list request before storing it.
  async connect(input: string) {
    const parsed = ClaudeKey.safeParse(input);
    if (!parsed.success)
      throw new DomainError('claude_key_invalid', '這不像有效的 Claude API key，請重新複製。', 400);
    try {
      await this.createClient(parsed.data).models.list({ limit: 1 });
    } catch (error) {
      throw this.failure(error, '無法確認這把 Claude API key，請稍後再試。');
    }
    mkdirSync(dirname(this.credentialsPath), { recursive: true, mode: 0o700 });
    writeFileSync(`${this.credentialsPath}.tmp`, JSON.stringify({ api_key: parsed.data }), {
      mode: 0o600,
    });
    renameSync(`${this.credentialsPath}.tmp`, this.credentialsPath);
    this.saved = parsed.data;
    return this.status();
  }
  disconnect() {
    rmSync(this.credentialsPath, { force: true });
    this.saved = null;
    return this.status();
  }
  async listModels() {
    if (!this.key) return { models: KNOWN_MODELS, live: false };
    try {
      const models: { model: string; name: string }[] = [];
      for await (const entry of this.createClient(this.key).models.list({ limit: 100 })) {
        models.push({ model: entry.id, name: entry.display_name });
        if (models.length >= 100) break;
      }
      return models.length ? { models, live: true } : { models: KNOWN_MODELS, live: false };
    } catch {
      return { models: KNOWN_MODELS, live: false };
    }
  }
  // Fixed messages only: provider payloads and key material never reach the UI.
  private failure(error: unknown, fallback: string) {
    if (error instanceof DomainError) return error;
    if (error instanceof Anthropic.AuthenticationError)
      return new DomainError(
        'claude_key_rejected',
        'Claude 不接受這把 API key，請在「模型與登入」重新連接。',
        401,
      );
    if (error instanceof Anthropic.PermissionDeniedError)
      return new DomainError('claude_forbidden', '這把 API key 沒有使用此模型的權限。', 403);
    if (error instanceof Anthropic.NotFoundError)
      return new DomainError('claude_model_missing', '找不到所選的 Claude 模型，請重新選擇。', 409);
    if (error instanceof Anthropic.RateLimitError)
      return new DomainError(
        'claude_rate_limited',
        'Claude 請求過於頻繁或額度不足，請稍後再試。',
        429,
      );
    if (error instanceof Anthropic.BadRequestError)
      return new DomainError('claude_bad_request', 'Claude 無法處理這次請求，請調整後重試。', 502);
    if (error instanceof Anthropic.APIConnectionError)
      return new DomainError('claude_unreachable', '無法連線到 Claude，請檢查網路後重試。', 502);
    if (error instanceof Anthropic.APIError)
      return new DomainError('claude_unavailable', 'Claude 服務暫時無法使用，請稍後重試。', 502);
    return new DomainError('model_unavailable', fallback, 502);
  }
  async generate(
    pkg: ContextPackage,
    onDraft?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<Answer> {
    if (!this.key)
      throw new DomainError(
        'provider_not_configured',
        '請先在「模型與登入」連接 Claude API key。',
        503,
      );
    try {
      const stream = this.createClient(this.key).beta.messages.stream(
        {
          model: this.model,
          max_tokens: 32000,
          system: ANSWER_INSTRUCTIONS,
          messages: [{ role: 'user', content: modelInput(pkg) }],
          output_config: { format: betaZodOutputFormat(AnswerSchema) },
          // If the selected model declines for a safety reason, the API reruns the
          // request on the model it routes that category to.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal },
      );
      let output = '';
      stream.on('text', (delta) => {
        output += delta;
        const draft = partialAnswer(output);
        if (draft !== null) onDraft?.(draft);
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal')
        throw new DomainError('model_refused', 'Claude 拒絕了這次請求，可調整問題後重試。', 502);
      if (message.stop_reason === 'max_tokens')
        throw new DomainError('model_incomplete', '回答過長而未完成，可縮小問題後重試。', 502);
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : []));
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.join(''));
      } catch {
        throw new DomainError('invalid_model_output', '模型返回格式不符合规范，请重试。', 502);
      }
      return validateAnswer(parsed, pkg);
    } catch (error) {
      if (signal?.aborted) throw new DomainError('generation_cancelled', '回答已停止。', 499);
      throw this.failure(error, '模型服务连接或格式异常，请重试。');
    }
  }
}

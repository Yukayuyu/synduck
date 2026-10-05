import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { DomainError, type ContextPackage } from '@acc/domain';
import { DemoProvider, OpenAIProvider, type ModelProvider } from './index';
import { CodexProvider } from './codex';
import { CodexRpc } from './codex-rpc';

export const ProviderMode = z.enum(['demo', 'openai', 'codex']);
export class ProviderRegistry implements ModelProvider {
  private active = 0;
  private mode: z.infer<typeof ProviderMode>;
  readonly codex: CodexProvider;
  private providers: Record<z.infer<typeof ProviderMode>, ModelProvider>;
  constructor(
    private readonly settingsPath: string,
    env: Record<string, string | undefined> = process.env,
    codex?: CodexProvider,
  ) {
    this.mode = ProviderMode.parse(env.LLM_PROVIDER || 'demo');
    try {
      this.mode = z
        .object({ provider: ProviderMode })
        .parse(JSON.parse(readFileSync(settingsPath, 'utf8'))).provider;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Invalid model settings file; restore it before startup.');
    }
    this.codex =
      codex ||
      new CodexProvider(
        new CodexRpc(env.APP_CODEX_HOME || './data/codex'),
        env.CODEX_MODEL || 'gpt-5.4',
      );
    this.providers = {
      demo: new DemoProvider(),
      openai: new OpenAIProvider(env.LLM_MODEL || '', env.LLM_API_KEY || env.OPENAI_API_KEY || ''),
      codex: this.codex,
    };
  }
  get name() {
    return this.mode;
  }
  get model() {
    return this.providers[this.mode].model;
  }
  async generate(pkg: ContextPackage, onDraft?: (text: string) => void) {
    this.active++;
    try {
      return await this.providers[this.mode].generate(pkg, onDraft);
    } finally {
      this.active--;
    }
  }
  async select(mode: z.infer<typeof ProviderMode>) {
    if (mode === 'codex' && !(await this.codex.status()).connected)
      throw new DomainError('codex_login_required', '請先完成 ChatGPT 登入。', 409);
    if (this.active)
      throw new DomainError('generation_active', '回答正在生成，請稍後切換模式。', 409);
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(`${this.settingsPath}.tmp`, JSON.stringify({ provider: mode }), { mode: 0o600 });
    renameSync(`${this.settingsPath}.tmp`, this.settingsPath);
    this.mode = mode;
    return { provider: this.name, model: this.model };
  }
  close() {
    return this.codex.close();
  }
}

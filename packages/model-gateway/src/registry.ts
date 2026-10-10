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
    let savedModel: string | undefined;
    try {
      const settings = z
        .object({
          provider: ProviderMode,
          codex_model: z.string().trim().min(1).max(256).optional(),
        })
        .parse(JSON.parse(readFileSync(settingsPath, 'utf8')));
      this.mode = settings.provider;
      savedModel = settings.codex_model;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Invalid model settings file; restore it before startup.');
    }
    this.codex =
      codex ||
      new CodexProvider(
        new CodexRpc(env.APP_CODEX_HOME || './data/codex'),
        savedModel ?? env.CODEX_MODEL?.trim() ?? '',
      );
    if (codex && savedModel !== undefined) this.codex.setModel(savedModel);
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
  async select(mode: z.infer<typeof ProviderMode>, model?: string) {
    const idle = () => {
      if (this.active || this.codex.diagnostics().generating)
        throw new DomainError('generation_active', '回答正在生成，請稍後切換模型或模式。', 409);
    };
    idle();
    if (model !== undefined && mode !== 'codex')
      throw new DomainError(
        'invalid_model_selection',
        '目前模型選單只適用於 ChatGPT / Codex。',
        400,
      );
    let nextModel = this.codex.model;
    if (mode === 'codex') {
      const { models } = await this.codex.listModels();
      nextModel =
        model ??
        (this.codex.model ||
          models.find((entry) => entry.is_default)?.model ||
          models[0]?.model ||
          '');
      if (!models.some((entry) => entry.model === nextModel))
        throw new DomainError(
          'codex_model_unavailable',
          '所選模型不在目前可選列表中，請在「模型與登入」刷新並重新選擇。',
          409,
        );
    }
    // Recheck after account/catalog I/O, before changing persisted settings.
    idle();
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(
      `${this.settingsPath}.tmp`,
      JSON.stringify({
        provider: mode,
        ...(nextModel ? { codex_model: nextModel } : {}),
      }),
      { mode: 0o600 },
    );
    renameSync(`${this.settingsPath}.tmp`, this.settingsPath);
    this.mode = mode;
    if (nextModel) this.codex.setModel(nextModel);
    return { provider: this.name, model: this.model };
  }
  close() {
    return this.codex.close();
  }
}

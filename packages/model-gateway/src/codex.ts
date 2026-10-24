import { z } from 'zod';
import {
  AnswerSchema,
  ANSWER_INSTRUCTIONS,
  DomainError,
  modelInput,
  type ContextPackage,
} from '@acc/domain';
import { validateAnswer, partialAnswer, type ModelProvider } from './index';
import { CODEX_CONFIG, type CodexConnection } from './codex-rpc';
import { codexError } from './codex-errors';

type AgentItem = { type?: string; text?: string; phase?: string };
type CodexTurn = { id?: string; status?: string; error?: unknown; items?: AgentItem[] };
const passiveItems = new Set([
  'userMessage',
  'agentMessage',
  'reasoning',
  'plan',
  'contextCompaction',
]);

const AccountResponse = z.object({
  account: z
    .union([
      z.object({ type: z.literal('chatgpt'), email: z.string().nullable(), planType: z.string() }),
      z.object({ type: z.string() }),
    ])
    .nullable(),
});
const DeviceLogin = z.object({
  type: z.literal('chatgptDeviceCode'),
  loginId: z.string(),
  verificationUrl: z.string().url(),
  userCode: z.string().min(1).max(100),
});
export const ReasoningEffort = z.string().trim().min(1).max(128);
const ModelEntry = z.object({
  model: z.string().min(1).max(256),
  displayName: z.string().max(256),
  description: z.string().max(10000),
  hidden: z.boolean(),
  isDefault: z.boolean(),
  defaultReasoningEffort: ReasoningEffort,
  supportedReasoningEfforts: z
    .array(
      z.object({
        reasoningEffort: ReasoningEffort,
        description: z.string().max(10000),
      }),
    )
    .max(64),
  inputModalities: z.array(z.string()).optional(),
  upgradeInfo: z.object({ retirementAt: z.number().nullable().optional() }).nullable().optional(),
});
const ModelPage = z.object({
  data: z.array(ModelEntry).max(1000),
  nextCursor: z.string().max(10000).nullable().optional(),
});
export type LoginState = {
  status: 'idle' | 'pending' | 'complete' | 'failed';
  verificationUrl?: string;
  userCode?: string;
};
export class CodexProvider implements ModelProvider {
  readonly name = 'codex';
  private selectedModel: string;
  private selectedReasoningEffort: string | null;
  private login: LoginState & { loginId?: string } = { status: 'idle' };
  private loginStarting = false;
  private generating = 0;
  private closed = false;
  private lastFailure: {
    code: string;
    message: string;
    stage: string;
    elapsed_ms: number;
    occurred_at: string;
  } | null = null;
  private lastRetry: { code: string; message: string } | null = null;
  private unsubscribe: () => void;
  constructor(
    private readonly rpc: CodexConnection,
    model = '',
    reasoningEffort: string | null = null,
  ) {
    this.selectedModel = model;
    this.selectedReasoningEffort = reasoningEffort;
    this.unsubscribe = rpc.subscribe(({ method, params }) => {
      if (method === 'account/login/completed' && params.loginId === this.login.loginId)
        this.login = { status: params.success === true ? 'complete' : 'failed' };
      if (method === 'canvas/disconnected' && this.login.status === 'pending')
        this.login = { status: 'failed' };
    });
  }
  get model() {
    return this.selectedModel;
  }
  get reasoningEffort() {
    return this.selectedReasoningEffort;
  }
  setSelection(model: string, reasoningEffort: string | null) {
    this.assertIdle();
    this.selectedModel = model;
    this.selectedReasoningEffort = reasoningEffort;
  }
  async listModels() {
    if (!(await this.status()).connected)
      throw new DomainError('codex_login_required', '請先完成 ChatGPT 登入，再取得模型列表。', 409);
    try {
      const models = new Map<
        string,
        {
          model: string;
          name: string;
          description: string;
          is_default: boolean;
          default_reasoning_effort: string;
          supported_reasoning_efforts: { effort: string; description: string }[];
        }
      >();
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const response = ModelPage.parse(
          await this.rpc.request('model/list', {
            cursor,
            limit: 100,
            includeHidden: false,
          }),
        );
        for (const entry of response.data) {
          if (entry.hidden || (entry.inputModalities && !entry.inputModalities.includes('text')))
            continue;
          const retired = entry.upgradeInfo?.retirementAt;
          if (retired != null && retired <= Date.now() / 1000) continue;
          models.set(entry.model, {
            model: entry.model,
            name: entry.displayName,
            description: entry.description,
            is_default: entry.isDefault,
            default_reasoning_effort: entry.defaultReasoningEffort,
            supported_reasoning_efforts: [
              ...new Map(
                entry.supportedReasoningEfforts.map((option) => [
                  option.reasoningEffort,
                  { effort: option.reasoningEffort, description: option.description },
                ]),
              ).values(),
            ],
          });
        }
        cursor = response.nextCursor || null;
        if (!cursor)
          return {
            models: [...models.values()],
            selected_model: this.model,
            selected_reasoning_effort: this.reasoningEffort,
          };
        if (cursors.has(cursor)) break;
        cursors.add(cursor);
      }
      throw new Error('Invalid model pagination');
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        'codex_model_list_failed',
        '無法取得 Codex 模型列表，請刷新或確認連線後重試。',
        502,
      );
    }
  }
  async status() {
    const result = AccountResponse.parse(
      await this.rpc.request('account/read', { refreshToken: false }),
    );
    const account = result.account;
    return {
      connected: account?.type === 'chatgpt',
      account:
        account && 'email' in account ? { email: account.email, plan: account.planType } : null,
      login: {
        status: this.login.status,
        verificationUrl: this.login.verificationUrl,
        userCode: this.login.userCode,
      },
    };
  }
  diagnostics() {
    return {
      model: this.model,
      reasoning_effort: this.reasoningEffort,
      generating: this.generating > 0,
      active_generations: this.generating,
      last_failure: this.lastFailure,
      last_retry: this.lastRetry,
    };
  }
  async startLogin() {
    this.assertIdle();
    if (this.loginStarting) throw new DomainError('login_busy', '正在建立登入，請稍候。', 409);
    if (this.login.status === 'pending') return this.status();
    this.loginStarting = true;
    try {
      const result = DeviceLogin.parse(
        await this.rpc.request('account/login/start', { type: 'chatgptDeviceCode' }),
      );
      const url = new URL(result.verificationUrl);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'auth.openai.com' ||
        url.username ||
        url.password ||
        url.port
      )
        throw new Error('Unexpected login destination');
      this.login = {
        status: 'pending',
        loginId: result.loginId,
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
      };
      return this.status();
    } catch {
      this.login = { status: 'failed' };
      throw new DomainError(
        'codex_login_failed',
        '無法開始 ChatGPT 登入。請確認網路與帳號的 Codex 裝置碼登入設定後重試。',
        503,
      );
    } finally {
      this.loginStarting = false;
    }
  }
  async cancelLogin() {
    this.assertIdle();
    if (this.login.loginId)
      await this.rpc.request('account/login/cancel', { loginId: this.login.loginId });
    this.login = { status: 'idle' };
    return this.status();
  }
  async logout() {
    this.assertIdle();
    if (this.loginStarting) throw new DomainError('login_busy', '正在建立登入，請稍候。', 409);
    await this.cancelLogin();
    await this.rpc.request('account/logout', {});
    this.login = { status: 'idle' };
    return this.status();
  }
  private assertIdle() {
    if (this.generating)
      throw new DomainError('codex_busy', '回答正在生成，請完成後再變更登入。', 409);
  }
  async generate(pkg: ContextPackage, onDraft?: (text: string) => void, signal?: AbortSignal) {
    if (this.closed) throw new DomainError('codex_unavailable', '模型連線已關閉。', 503);
    if (this.loginStarting || this.login.status === 'pending')
      throw new DomainError('login_busy', '請先完成帳號登入。', 409);
    this.generating++;
    if (this.generating === 1) {
      this.lastFailure = null;
      this.lastRetry = null;
    }
    const model = this.model;
    const effort = this.reasoningEffort;
    let retry: { code: string; message: string } | null = null;
    const startedAt = Date.now();
    let stage = 'account/read';
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let threadId = '';
    let turnId = '';
    let completed = false;
    let connectionLost = false;
    let needsStop = false;
    let interruptSent = false;
    let onAbort = () => {};
    const interruptOwnTurn = async () => {
      if (!threadId || !turnId || interruptSent || connectionLost || this.closed) return;
      interruptSent = true;
      await this.rpc.request('turn/interrupt', { threadId, turnId }).catch(() => {});
    };
    try {
      signal?.throwIfAborted();
      if (!model)
        throw new DomainError(
          'codex_model_required',
          '請在「模型與登入」選擇 Codex 模型後再提交。',
          409,
        );
      if (!(await this.status()).connected)
        throw new DomainError(
          'codex_login_required',
          '請先在「模型與登入」使用 ChatGPT 帳號登入。',
          503,
        );
      signal?.throwIfAborted();
      stage = 'thread/start';
      const thread = z
        .object({
          thread: z.object({ id: z.string() }),
          model: z.string(),
          instructionSources: z.array(z.string()).optional(),
        })
        .parse(
          await this.rpc.request('thread/start', {
            model,
            modelProvider: 'openai',
            ephemeral: true,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            environments: [],
            dynamicTools: [],
            selectedCapabilityRoots: [],
            config: CODEX_CONFIG,
            baseInstructions: ANSWER_INSTRUCTIONS,
            developerInstructions:
              'Use only the supplied context package. Do not use tools, files, memory, browsing, or other conversations. Return only the requested structured answer. Graph changes are proposals, never actions.',
          }),
        );
      threadId = thread.thread.id;
      if (thread.model !== model || thread.instructionSources?.length)
        throw new DomainError(
          'codex_context_mismatch',
          'Codex 模型或額外指令與設定不符，已停止本次生成。',
          502,
        );
      signal?.throwIfAborted();
      const answer = await new Promise<string>((resolve, reject) => {
        let finalText = '';
        let partial = '';
        let partialIsCommentary = false;
        let settled = false;
        const fail = (error: DomainError, failedStage = 'generation') => {
          if (settled) return;
          settled = true;
          stage = failedStage;
          clearTimeout(timer);
          reject(error);
        };
        const blocked = () =>
          fail(
            new DomainError(
              'codex_tool_blocked',
              'Codex 嘗試使用本應用未開放的工具，已停止回答。請改用只需要文字回答的問題。',
              502,
            ),
          );
        const finishTurn = (turn: CodexTurn | undefined) => {
          if (settled) return;
          if (turn?.error) {
            fail(codexError(turn.error));
            return;
          }
          if (turn?.status !== 'completed') {
            fail(new DomainError('codex_interrupted', 'Codex 回答被中斷，請重試。', 502));
            return;
          }
          const items = turn.items || [];
          if (items.some((item) => item.type && !passiveItems.has(item.type))) {
            blocked();
            return;
          }
          const final = items.findLast(
            (item) =>
              item.type === 'agentMessage' &&
              item.phase !== 'commentary' &&
              typeof item.text === 'string',
          );
          const hasCommentary = items.some(
            (item) => item.type === 'agentMessage' && item.phase === 'commentary',
          );
          const text =
            final?.text || finalText || (!partialIsCommentary && !hasCommentary ? partial : '');
          if (!text || text.length > 200_000) {
            fail(
              new DomainError('codex_invalid_response', 'Codex 未返回完整有效回答，請重試。', 502),
            );
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(text);
        };
        timer = setTimeout(
          () =>
            fail(
              new DomainError(
                'codex_generation_timeout',
                `Codex 生成超過 3 分鐘，已停止本次回答。${retry ? `最近的重試原因：${retry.message}` : '請稍後重試或縮短問題。'}`,
                504,
              ),
            ),
          180_000,
        );
        unsubscribe = this.rpc.subscribe(({ method, params }) => {
          if (settled) return;
          if (method === 'canvas/disconnected') {
            connectionLost = true;
            fail(
              new DomainError(
                'codex_disconnected',
                'Codex 本機程序的連線已中斷，請重試並確認後端仍在運作。',
                502,
              ),
            );
            return;
          }
          if (params.threadId !== threadId) return;
          stage = 'generation';
          if (method === 'turn/started')
            turnId = (params.turn as CodexTurn | undefined)?.id || turnId;
          if (method === 'error') {
            const error = codexError(params.error);
            if (params.willRetry === true) {
              retry = { code: error.code, message: error.message };
              this.lastRetry = retry;
            } else fail(error);
            return;
          }
          if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
            partial += params.delta;
            if (partial.length > 200_000) {
              fail(
                new DomainError(
                  'codex_output_too_large',
                  'Codex 回答超過大小限制，請縮短問題後重試。',
                  502,
                ),
              );
              return;
            }
            const draft = partialAnswer(partial);
            if (draft !== null) onDraft?.(draft);
          }
          if (method === 'item/started' || method === 'item/completed') {
            const item = params.item as AgentItem | undefined;
            if (item?.type && !passiveItems.has(item.type)) {
              blocked();
              return;
            }
            if (item?.type === 'agentMessage') {
              if (method === 'item/started') partial = '';
              partialIsCommentary = item.phase === 'commentary';
            }
            if (
              method === 'item/completed' &&
              item?.type === 'agentMessage' &&
              typeof item.text === 'string' &&
              item.phase !== 'commentary'
            )
              finalText = item.text;
          }
          if (method === 'turn/completed') {
            finishTurn(params.turn as CodexTurn | undefined);
          }
        });
        onAbort = () =>
          fail(
            new DomainError('generation_cancelled', '已停止這段回答，可使用原上下文重試。', 499),
          );
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) {
          onAbort();
          return;
        }
        stage = 'turn/start';
        void this.rpc
          .request('turn/start', {
            threadId,
            ...(effort !== null ? { effort } : {}),
            input: [{ type: 'text', text: modelInput(pkg), text_elements: [] }],
            environments: [],
            outputSchema: z.toJSONSchema(AnswerSchema),
          })
          .then((response) => {
            const turn = (response as { turn?: CodexTurn } | undefined)?.turn;
            turnId = turn?.id || turnId;
            if (needsStop) void interruptOwnTurn();
            if (turn && ['completed', 'failed', 'interrupted'].includes(turn.status || ''))
              finishTurn(turn);
          })
          .catch((error: unknown) =>
            fail(error instanceof DomainError ? error : codexError(error), 'turn/start'),
          );
      });
      signal?.throwIfAborted();
      const result = validateAnswer(JSON.parse(answer), pkg);
      completed = true;
      return result;
    } catch (error) {
      const failure = signal?.aborted
        ? new DomainError('generation_cancelled', '已停止這段回答，可使用原上下文重試。', 499)
        : error instanceof DomainError
          ? error
          : new DomainError('codex_invalid_response', 'Codex 未返回有效回答，請重試。', 502);
      this.lastFailure = {
        code: failure.code,
        message: failure.message,
        stage,
        elapsed_ms: Date.now() - startedAt,
        occurred_at: new Date().toISOString(),
      };
      throw failure;
    } finally {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      needsStop = !completed;
      // Stop/unload this ephemeral thread only. A failure or cancellation must
      // never close the shared app-server while other conversations are running.
      if (threadId && !connectionLost && !this.closed) {
        if (needsStop) await interruptOwnTurn();
        await this.rpc.request('thread/unsubscribe', { threadId }).catch(() => {});
      }
      this.generating--;
    }
  }
  close() {
    this.closed = true;
    this.unsubscribe();
    return this.rpc.close();
  }
}

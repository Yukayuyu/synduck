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
type CodexTurn = { status?: string; error?: unknown; items?: AgentItem[] };
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
export type LoginState = {
  status: 'idle' | 'pending' | 'complete' | 'failed';
  verificationUrl?: string;
  userCode?: string;
};
export class CodexProvider implements ModelProvider {
  readonly name = 'codex';
  readonly model: string;
  private login: LoginState & { loginId?: string } = { status: 'idle' };
  private loginStarting = false;
  private generating = false;
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
    model = 'gpt-5.4',
  ) {
    this.model = model;
    this.unsubscribe = rpc.subscribe(({ method, params }) => {
      if (method === 'account/login/completed' && params.loginId === this.login.loginId)
        this.login = { status: params.success === true ? 'complete' : 'failed' };
      if (method === 'canvas/disconnected' && this.login.status === 'pending')
        this.login = { status: 'failed' };
    });
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
      generating: this.generating,
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
  async generate(pkg: ContextPackage, onDraft?: (text: string) => void) {
    this.assertIdle();
    if (this.loginStarting || this.login.status === 'pending')
      throw new DomainError('login_busy', '請先完成帳號登入。', 409);
    this.generating = true;
    this.lastFailure = null;
    this.lastRetry = null;
    const startedAt = Date.now();
    let stage = 'account/read';
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    let threadId = '';
    let completed = false;
    try {
      if (!(await this.status()).connected)
        throw new DomainError(
          'codex_login_required',
          '請先在「模型與登入」使用 ChatGPT 帳號登入。',
          503,
        );
      stage = 'thread/start';
      const thread = z
        .object({
          thread: z.object({ id: z.string() }),
          model: z.string(),
          instructionSources: z.array(z.string()).optional(),
        })
        .parse(
          await this.rpc.request('thread/start', {
            model: this.model,
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
      if (thread.model !== this.model || thread.instructionSources?.length)
        throw new DomainError(
          'codex_context_mismatch',
          'Codex 模型或額外指令與設定不符，已停止本次生成。',
          502,
        );
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
                `Codex 生成超過 3 分鐘，已停止本次回答。${this.lastRetry ? `最近的重試原因：${this.lastRetry.message}` : '請稍後重試或縮短問題。'}`,
                504,
              ),
            ),
          180_000,
        );
        unsubscribe = this.rpc.subscribe(({ method, params }) => {
          if (settled) return;
          if (method === 'canvas/disconnected') {
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
          if (method === 'error') {
            const error = codexError(params.error);
            if (params.willRetry === true)
              this.lastRetry = { code: error.code, message: error.message };
            else fail(error);
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
        stage = 'turn/start';
        void this.rpc
          .request('turn/start', {
            threadId,
            input: [{ type: 'text', text: modelInput(pkg), text_elements: [] }],
            environments: [],
            outputSchema: z.toJSONSchema(AnswerSchema),
          })
          .then((response) => {
            const turn = (response as { turn?: CodexTurn } | undefined)?.turn;
            if (turn && ['completed', 'failed', 'interrupted'].includes(turn.status || ''))
              finishTurn(turn);
          })
          .catch((error: unknown) =>
            fail(error instanceof DomainError ? error : codexError(error), 'turn/start'),
          );
      });
      const result = validateAnswer(JSON.parse(answer), pkg);
      completed = true;
      return result;
    } catch (error) {
      const failure =
        error instanceof DomainError
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
      // Unload an ephemeral thread, also stopping any work left after timeout.
      if (threadId && !completed) await this.rpc.close();
      if (threadId && completed) {
        try {
          await this.rpc.request('thread/unsubscribe', { threadId });
        } catch {
          await this.rpc.close();
        }
      }
      this.generating = false;
    }
  }
  close() {
    this.unsubscribe();
    return this.rpc.close();
  }
}

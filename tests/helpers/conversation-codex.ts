import type {
  CodexConnection,
  HostToolHandler,
  RpcEvent,
} from '../../packages/model-gateway/src/codex-rpc';

// Deterministic model transport, used only in tests. All filesystem actions and
// approval endpoints still run through the real LocalExecutor and API.
export class ConversationCodex implements CodexConnection {
  listeners = new Set<(event: RpcEvent) => void>();
  handlers = new Map<string, HostToolHandler>();
  calls: { method: string; params: Record<string, unknown> }[] = [];
  requests: { thread: string; result: unknown }[] = [];
  next = 0;
  hostScope: <T>(work: () => Promise<T>) => Promise<T> = (work) => work();
  emit(method: string, params: Record<string, unknown>) {
    for (const listener of this.listeners) listener({ method, params });
  }
  registerTools(id: string, handler: HostToolHandler) {
    this.handlers.set(id, handler);
    return () => this.handlers.delete(id);
  }
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    if (method === 'account/read')
      return { account: { type: 'chatgpt', email: 'test@example.test', planType: 'plus' } } as T;
    if (method === 'model/list')
      return {
        data: [
          {
            model: 'test-model',
            displayName: 'Test Model',
            description: 'Test transport',
            hidden: false,
            isDefault: true,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
          },
        ],
        nextCursor: null,
      } as T;
    if (method === 'thread/start')
      return {
        thread: { id: 'conversation-' + ++this.next },
        model: params.model,
        instructionSources: [],
      } as T;
    if (method === 'turn/start') {
      const threadId = String(params.threadId);
      this.emit('turn/started', { threadId, turn: { id: 'turn-' + threadId } });
      void this.respond(threadId, params);
      return { turn: { id: 'turn-' + threadId, status: 'inProgress' } } as T;
    }
    return {} as T;
  }
  async respond(threadId: string, params: Record<string, unknown>) {
    const input = JSON.parse((params.input as { text: string }[])[0].text);
    const project = input.current_prompt.match(/^授權專案:(.+)$/m)?.[1];
    const writing = !!project || input.current_prompt.includes('确认写入');
    const reading = writing || input.current_prompt.includes('读取项目');
    const connecting = input.current_prompt.includes('连接GitHub');
    let text = '## 文字回答\n\n这段对话没有使用工具。';
    if (connecting) {
      this.emit('item/started', { threadId, item: { type: 'dynamicToolCall' } });
      const result = await this.hostScope(() =>
        this.handlers.get(threadId)!({
          threadId,
          tool: 'canvas_connect_service',
          arguments: { service: 'github' },
          callId: 'github-login',
        }),
      );
      this.requests.push({ thread: threadId, result });
      this.emit('item/completed', { threadId, item: { type: 'dynamicToolCall' } });
      text = JSON.stringify(result).includes('"success":true')
        ? '## 连接已完成\n\nGitHub 已连接，之后的画布可以继续使用。'
        : '连接未完成，请查看连接卡片。';
    }
    if (reading) {
      for (const [tool, args] of [
        ...(project
          ? [
              [
                'canvas_connect_project',
                { root: project, create_if_missing: input.current_prompt.includes('建立目錄') },
              ],
            ]
          : []),
        ['canvas_read_file', { path: 'spec.txt' }],
        ...(writing
          ? [
              [
                'canvas_write_file',
                { path: 'result.txt', content: 'Verified canvas tool write.\n' },
              ],
            ]
          : []),
        ...(input.current_prompt.includes('命令測試')
          ? [
              [
                'canvas_run_command',
                {
                  command:
                    "node -e \"process.stdin.once('data',()=>{console.log('12345');setTimeout(()=>{},2200)})\"",
                  timeout_seconds: 30,
                  stdin: '\n',
                },
              ],
            ]
          : []),
      ] as [string, Record<string, unknown>][]) {
        if (!this.handlers.has(threadId)) return;
        this.emit('item/started', { threadId, item: { type: 'dynamicToolCall' } });
        const result = await this.hostScope(() =>
          this.handlers.get(threadId)!({
            threadId,
            tool,
            arguments: args,
            callId: tool,
          }),
        );
        this.requests.push({ thread: threadId, result });
        this.emit('item/completed', { threadId, item: { type: 'dynamicToolCall' } });
        text = JSON.stringify(result).includes('"success":true')
          ? '## 项目结果\n\n工具已返回实际结果。'
          : '操作未执行或已拒绝，请查看工具记录。';
      }
    }
    if (!this.handlers.has(threadId) && (reading || connecting)) return;
    const answer = { answer: text, used_source_ids: [], suggested_graph_updates: [] };
    this.emit('item/completed', {
      threadId,
      item: { type: 'agentMessage', text: JSON.stringify(answer), phase: 'final_answer' },
    });
    this.emit('turn/completed', {
      threadId,
      turn: {
        status: 'completed',
        items: [
          { type: 'agentMessage', text: JSON.stringify(answer), phase: 'final_answer' },
          ...(reading || connecting ? [{ type: 'dynamicToolCall' }] : []),
        ],
      },
    });
  }
  subscribe(listener: (event: RpcEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.handlers.clear();
  }
}

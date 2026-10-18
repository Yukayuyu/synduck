import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@acc/domain';
import { EvidenceStore, type Evidence } from './evidence';

export const DesktopArgs = z
  .object({
    operation: z.enum(['capture', 'click', 'double_click', 'type_text', 'key', 'scroll']),
    capture_id: z.string().uuid().optional(),
    x: z.number().int().min(0).max(8192).optional(),
    y: z.number().int().min(0).max(8192).optional(),
    text: z.string().max(2000).optional(),
    key: z
      .enum([
        'Enter',
        'Tab',
        'Escape',
        'Backspace',
        'Delete',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Control+A',
        'Control+C',
        'Control+V',
        'Control+Z',
        'Control+S',
      ])
      .optional(),
    delta: z.number().int().min(-5).max(5).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation !== 'capture' && !value.capture_id)
      ctx.addIssue({ code: 'custom', message: '操作需要截圖來源 ID' });
    if (
      ['click', 'double_click', 'scroll'].includes(value.operation) &&
      (value.x === undefined || value.y === undefined)
    )
      ctx.addIssue({ code: 'custom', message: '請提供截圖內的 x／y 座標' });
    if (value.operation === 'type_text' && !value.text?.length)
      ctx.addIssue({ code: 'custom', message: '請提供文字' });
    if (value.operation === 'key' && !value.key)
      ctx.addIssue({ code: 'custom', message: '請提供快捷鍵' });
    if (value.operation === 'scroll' && !value.delta)
      ctx.addIssue({ code: 'custom', message: '請提供非零捲動量' });
  });
export type DesktopOperation = z.infer<typeof DesktopArgs>;
export type DesktopWindow = { id: string; title: string; process_id: number };
export type Bounds = { left: number; top: number; width: number; height: number };
export type DesktopCapture = { png: Buffer; window: DesktopWindow; bounds: Bounds };
export type Frame = Evidence & { capture_id: string; window: DesktopWindow; bounds: Bounds };
export interface DesktopDriver {
  available: boolean;
  reason: string;
  windows(signal?: AbortSignal): Promise<DesktopWindow[]>;
  capture(window: string, signal: AbortSignal, processId?: number): Promise<DesktopCapture>;
  act(window: string, args: DesktopOperation, frame: Frame, signal: AbortSignal): Promise<void>;
}
const fail = (message: string) => new DomainError('desktop_unavailable', message, 409);
const WindowSchema = z.object({
  id: z.string().regex(/^\d+$/),
  title: z.string().max(1000),
  process_id: z.number().int(),
});
const BoundsSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export class WindowsDesktopDriver implements DesktopDriver {
  available = process.platform === 'win32';
  reason = this.available ? '' : '桌面控制目前支援 Windows 互動式桌面；這台後端不支援。';
  private request(body: object, signal?: AbortSignal): Promise<unknown> {
    if (!this.available) return Promise.reject(fail(this.reason));
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {};
      for (const key of [
        'PATH',
        'Path',
        'SystemRoot',
        'SYSTEMROOT',
        'WINDIR',
        'TEMP',
        'TMP',
        'COMSPEC',
        'PATHEXT',
      ])
        if (process.env[key]) env[key] = process.env[key];
      const child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          fileURLToPath(new URL('../desktop/windows.ps1', import.meta.url)),
        ],
        { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env },
      );
      let output = Buffer.alloc(0),
        stopped = false;
      const cancel = () => {
        stopped = true;
        child.kill();
      };
      const timer = setTimeout(cancel, 20000);
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', (part: Buffer) => {
        if (output.length + part.length > 12 * 1024 * 1024) cancel();
        else output = Buffer.concat([output, part]);
      });
      child.on('error', () => reject(fail('無法啟動 Windows 桌面工具。')));
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (code || stopped || signal?.aborted)
          return reject(fail('桌面操作中斷；請檢查目標視窗與實際狀態。'));
        try {
          const response = JSON.parse(
            output
              .toString('utf8')
              .trim()
              .replace(/^\uFEFF/, ''),
          );
          if (response.error)
            return reject(fail('桌面工具無法操作：' + String(response.error).slice(0, 160)));
          resolve(response);
        } catch {
          reject(fail('Windows 桌面工具沒有傳回有效結果。'));
        }
      });
      child.stdin.on('error', () => {});
      if (signal?.aborted) cancel();
      // Frame the single request explicitly; PowerShell can read it before
      // Windows signals that the parent has closed its redirected stdin.
      child.stdin.end(JSON.stringify(body) + '\n');
    });
  }
  async windows(signal?: AbortSignal) {
    return z
      .array(WindowSchema)
      .max(200)
      .parse(await this.request({ operation: 'windows' }, signal));
  }
  async capture(window: string, signal: AbortSignal, processId?: number) {
    const result = z
      .object({ png: z.string().max(12 * 1024 * 1024), window: WindowSchema, bounds: BoundsSchema })
      .parse(await this.request({ operation: 'capture', window, process_id: processId }, signal));
    return { ...result, png: Buffer.from(result.png, 'base64') };
  }
  async act(window: string, args: DesktopOperation, frame: Frame, signal: AbortSignal) {
    await this.request(
      {
        ...args,
        window,
        process_id: frame.window.process_id,
        bounds: frame.bounds,
        image_width: frame.width,
        image_height: frame.height,
      },
      signal,
    );
  }
}
export class DesktopManager {
  private settings: { enabled: boolean; window_id: string; process_id: number | null } = {
    enabled: false,
    window_id: '',
    process_id: null,
  };
  constructor(
    private readonly directory: string,
    readonly evidence: EvidenceStore,
    private readonly driver: DesktopDriver = new WindowsDesktopDriver(),
  ) {}
  async initialize() {
    try {
      this.settings = z
        .object({
          enabled: z.boolean(),
          window_id: z.string(),
          process_id: z.number().int().nullable().default(null),
        })
        .strict()
        .parse(JSON.parse(await fs.readFile(join(this.directory, 'desktop.json'), 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        this.settings = { enabled: false, window_id: '', process_id: null };
    }
    // Window handles can be recycled after process restart. Re-select the target explicitly.
    this.settings.enabled = false;
  }
  status() {
    return { ...this.settings, available: this.driver.available, reason: this.driver.reason };
  }
  windows(signal?: AbortSignal) {
    return this.driver.windows(signal);
  }
  async configure(enabled: boolean, window_id: string) {
    const window = enabled
      ? (await this.driver.windows()).find((window) => window.id === window_id)
      : undefined;
    if (enabled && (!this.driver.available || !window))
      throw fail(this.driver.reason || '請重新選擇目前開啟的目標視窗。');
    this.settings = { enabled, window_id, process_id: window?.process_id || null };
    const path = join(this.directory, 'desktop-' + randomUUID() + '.tmp');
    await fs.writeFile(path, JSON.stringify(this.settings), { mode: 0o600 });
    await fs.rename(path, join(this.directory, 'desktop.json'));
    return this.status();
  }
  assertReady() {
    if (!this.settings.enabled || !this.driver.available)
      throw fail('請先啟用桌面控制並選擇目標視窗。');
  }
  async capture(label: string, signal: AbortSignal): Promise<Frame> {
    this.assertReady();
    const result = await this.driver.capture(
      this.settings.window_id,
      signal,
      this.settings.process_id || undefined,
    );
    if (
      result.window.id !== this.settings.window_id ||
      result.window.process_id !== this.settings.process_id
    )
      throw fail('目標視窗已變更，操作停止。');
    const evidence = await this.evidence.put(result.png, 'image/png', label);
    return { ...evidence, capture_id: randomUUID(), window: result.window, bounds: result.bounds };
  }
  validateReference(frame: Frame, args: DesktopOperation) {
    this.assertReady();
    if (
      frame.window.id !== this.settings.window_id ||
      Date.now() - Date.parse(frame.captured_at) > 5 * 60 * 1000
    )
      throw fail('截圖已過期或不是目前的視窗，請重新擷取。');
    if (
      ['click', 'double_click', 'scroll'].includes(args.operation) &&
      (args.x! >= frame.width || args.y! >= frame.height)
    )
      throw fail('操作座標超出截圖範圍。');
  }
  async act(
    args: DesktopOperation,
    reference: Frame,
    before: Frame,
    signal: AbortSignal,
    onStarting?: () => Promise<void>,
  ) {
    this.validateReference(reference, args);
    if (
      reference.window.process_id !== before.window.process_id ||
      JSON.stringify(reference.bounds) !== JSON.stringify(before.bounds)
    )
      throw fail('目標視窗大小、位置或程序已變更；請根據新截圖重新提出操作。');
    signal.throwIfAborted();
    await onStarting?.();
    signal.throwIfAborted();
    await this.driver.act(this.settings.window_id, args, reference, signal);
  }
}

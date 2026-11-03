import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, CreateReferenceSchema } from '@acc/domain';
const maxFile = 5 * 1024 * 1024;
const hash = (bytes: Uint8Array) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const Input = z
  .object({
    request_id: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    position: CreateReferenceSchema.shape.position,
    text: z
      .string()
      .min(1)
      .max(1024 * 1024)
      .optional(),
    file: z
      .object({
        name: z.string().min(1).max(240),
        data: z
          .string()
          .min(1)
          .max(Math.ceil(maxFile / 3) * 4),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((i) => Boolean(i.text) !== Boolean(i.file));
let parsing = false;
async function extract(format: string, bytes: Buffer): Promise<string> {
  if (parsing) throw new DomainError('reference_busy', '另一份文件正在解析，請稍後再試。', 429);
  parsing = true;
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(
        new URL(
          process.env.CANVAS_COMPILED === '1' ? './document-worker.mjs' : './document-worker.ts',
          import.meta.url,
        ),
        {
          workerData: { format, bytes: new Uint8Array(bytes) },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
          stdout: true,
          stderr: true,
        },
      );
      worker.stdout.resume();
      worker.stderr.resume();
      let done = false;
      const finish = (text?: string, message?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        if (message) reject(new DomainError('reference_parse_failed', message, 422));
        else resolve(text!);
      };
      const timer = setTimeout(
        () => finish(undefined, '解析超過 30 秒；請先拆分文件或改用文字格式。'),
        30000,
      );
      worker.once('message', (message) => finish(message.text, message.error));
      worker.once('error', () =>
        finish(undefined, '文件解析失敗或超過記憶體限制，請改用文字格式。'),
      );
      worker.once('exit', () => {
        if (!done) finish(undefined, '文件解析中斷，請改用文字格式。');
      });
    });
  } finally {
    parsing = false;
  }
}
export async function parseReference(raw: unknown) {
  const input = Input.parse(raw);
  if (!input.file) {
    const text = input.text!;
    return CreateReferenceSchema.parse({
      ...input,
      metadata: {
        kind: 'paste',
        format: 'text',
        filename: null,
        original_bytes: Buffer.byteLength(text),
        original_sha256: hash(Buffer.from(text)),
      },
    });
  }
  const { name, data } = input.file;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new DomainError('reference_file_invalid', '文件編碼無效。');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > maxFile || bytes.toString('base64') !== data)
    throw new DomainError('reference_file_invalid', '文件須不超過 5 MiB。');
  const ext = name.toLowerCase().split('.').at(-1);
  const format =
    ext === 'pdf'
      ? 'pdf'
      : ext === 'docx'
        ? 'docx'
        : ['md', 'markdown'].includes(ext!)
          ? 'markdown'
          : ext === 'txt'
            ? 'text'
            : null;
  if (!format)
    throw new DomainError(
      'reference_file_unsupported',
      '支援 TXT、Markdown、PDF 與 DOCX；其他格式請先轉換。',
    );
  let text: string;
  if (format === 'pdf' || format === 'docx') text = await extract(format, bytes);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new DomainError('reference_encoding', '文字檔請先另存為 UTF-8。');
    }
  }
  if (!text.trim() || text.includes('\0') || Buffer.byteLength(text) > 1024 * 1024)
    throw new DomainError('reference_text_invalid', '參考文字須為非空文字，且不超過 1 MiB。');
  return CreateReferenceSchema.parse({
    request_id: input.request_id,
    title: input.title,
    position: input.position,
    text,
    metadata: {
      kind: 'file' as const,
      format,
      filename: name,
      original_bytes: bytes.length,
      original_sha256: hash(bytes),
    },
  });
}

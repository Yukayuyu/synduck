import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@acc/domain';

export type Evidence = {
  sha256: string;
  mime: 'image/png' | 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
  label: string;
  captured_at: string;
};
export class EvidenceStore {
  constructor(private readonly directory: string) {}
  async put(bytes: Uint8Array, mime: string, label: string): Promise<Evidence> {
    const data = Buffer.from(bytes);
    if (data.length > 8 * 1024 * 1024 || data.length < 24)
      throw new DomainError('evidence_size', '圖片大小不受支援。', 400);
    let width = 0,
      height = 0;
    if (
      mime === 'image/png' &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      width = data.readUInt32BE(16);
      height = data.readUInt32BE(20);
    } else if (mime === 'image/jpeg' && data[0] === 255 && data[1] === 216) {
      let offset = 2;
      while (offset + 9 < data.length) {
        if (data[offset] !== 255) break;
        const marker = data[offset + 1],
          size = data.readUInt16BE(offset + 2);
        if ([192, 193, 194].includes(marker)) {
          height = data.readUInt16BE(offset + 5);
          width = data.readUInt16BE(offset + 7);
          break;
        }
        if (size < 2) break;
        offset += size + 2;
      }
    }
    if (!width || !height || width > 8192 || height > 8192 || width * height > 32_000_000)
      throw new DomainError('evidence_format', '只支援有效的 PNG／JPEG 圖片。', 400);
    const sha256 = createHash('sha256').update(data).digest('hex');
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(join(this.directory, sha256), data, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    return {
      sha256,
      mime: mime as Evidence['mime'],
      bytes: data.length,
      width,
      height,
      label: label.slice(0, 160),
      captured_at: new Date().toISOString(),
    };
  }
  async read(evidence: Evidence) {
    if (!/^[a-f0-9]{64}$/.test(evidence.sha256))
      throw new DomainError('evidence_missing', '找不到操作圖片。', 404);
    const bytes = await fs.readFile(join(this.directory, evidence.sha256));
    if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256)
      throw new DomainError('evidence_changed', '操作圖片的完整性校驗失敗。', 409);
    return bytes;
  }
}

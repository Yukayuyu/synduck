import { crc32, deflateSync } from 'node:zlib';
import type {
  DesktopDriver,
  DesktopOperation,
  Frame,
} from '../../packages/local-runtime/src/desktop';
export function testPng(changed = false) {
  const width = 640,
    height = 360;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 3) + 1 + x * 3;
      const color =
        y < 35
          ? [52, 65, 91]
          : x < 140
            ? [231, 236, 244]
            : y > 90 && y < 130 && x > 175 && x < (changed ? 500 : 350)
              ? changed
                ? [100, 170, 131]
                : [143, 161, 200]
              : [248, 249, 252];
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  const chunk = (kind: string, body: Buffer) => {
    const type = Buffer.from(kind),
      size = Buffer.alloc(4),
      check = Buffer.alloc(4);
    size.writeUInt32BE(body.length);
    check.writeUInt32BE(crc32(Buffer.concat([type, body])));
    return Buffer.concat([size, type, body, check]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export class TestDesktopDriver implements DesktopDriver {
  available = true;
  reason = '';
  operations: DesktopOperation[] = [];
  bounds = { left: 20, top: 30, width: 1280, height: 720 };
  window = { id: '123', title: '測試視窗（模擬桌面）', process_id: 456 };
  async windows() {
    return [this.window];
  }
  async capture() {
    return {
      png: testPng(this.operations.length > 0),
      window: { ...this.window },
      bounds: { ...this.bounds },
    };
  }
  async act(_window: string, args: DesktopOperation, _frame: Frame, signal: AbortSignal) {
    signal.throwIfAborted();
    this.operations.push(args);
  }
}

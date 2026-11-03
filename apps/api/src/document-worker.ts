import { parentPort, workerData } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
const limit = 1024 * 1024;
try {
  const { format, bytes } = workerData as { format: string; bytes: Uint8Array };
  let text = '';
  if (format === 'pdf') {
    const options = {
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
    };
    const pdf = await getDocumentProxy(bytes, options);
    try {
      if (pdf.numPages > 250) throw new Error('文件超過 250 頁；請先拆分。');
      const pages: string[] = [];
      let length = 0;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        const value = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .trim();
        length += Buffer.byteLength(value);
        if (length > limit) throw new Error('擷取文字超過 1 MiB；請先拆分。');
        pages.push(value);
        page.cleanup();
      }
      text = pages.join('\n\n');
    } finally {
      await pdf.loadingTask.destroy();
    }
  } else {
    let expanded = 0,
      entries = 0;
    unzipSync(bytes, {
      filter: (entry) => {
        if (++entries > 2000 || (expanded += entry.originalSize) > 20 * 1024 * 1024)
          throw new Error('Word 文件展開後過大；請先簡化文件。');
        return false;
      },
    });
    text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  }
  if (!text.trim()) throw new Error('沒有可擷取的文字。掃描 PDF 請先進行 OCR，再匯入文字。');
  if (Buffer.byteLength(text) > limit) throw new Error('擷取文字超過 1 MiB；請先拆分。');
  parentPort!.postMessage({ text });
} catch (error) {
  const message =
    error instanceof Error &&
    /^(文件超過|擷取文字超過|Word 文件展開|沒有可擷取)/.test(error.message)
      ? error.message
      : '文件無法解析；請確認格式、解除密碼保護，或改用 TXT／Markdown。';
  parentPort!.postMessage({ error: message });
}

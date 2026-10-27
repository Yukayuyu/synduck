import { decodeString } from 'micromark-util-decode-string';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { Nodes } from 'mdast';
import type { SourceRun } from './source-ranges';

export function parseMarkdown(text: string) {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

// Position offsets come from the CommonMark parser, not a search through the
// rendered document. This keeps repeated phrases, emoji and hidden syntax exact.
export function sourceRuns(source: string, node: Nodes): SourceRun[] {
  const original = 'value' in node ? node.value : 'alt' in node ? (node.alt ?? '') : '';
  const value = node.type === 'inlineCode' ? original.replace(/\r\n?|\n/g, ' ') : original;
  let start = node.position?.start.offset ?? 0;
  let end = node.position?.end.offset ?? start;
  const code = node.type === 'code' || node.type === 'inlineCode' || node.type === 'html';
  if (node.type === 'inlineCode') {
    const delimiter = /^\x60+/.exec(source.slice(start, end))?.[0].length ?? 0;
    start += delimiter;
    end -= delimiter;
    const inner = source.slice(start, end);
    const normalized = inner.replace(/\r\n?|\n/g, ' ');
    if (normalized.length === value.length + 2 && normalized.slice(1, -1) === value) {
      start += inner.startsWith('\r\n') ? 2 : 1;
      end -= inner.endsWith('\r\n') ? 2 : 1;
    }
  } else if (node.type === 'code' && /^(?:\x60{3,}|~{3,})/.test(source.slice(start, end))) {
    const line = source.slice(start, end).search(/\r?\n/);
    if (line !== -1) start += line + (source[start + line] === '\r' ? 2 : 1);
  } else if (node.type === 'image' || node.type === 'imageReference') start += 2;
  const runs: SourceRun[] = [];
  let cursor = start;
  let visible = 0;
  let beginningLine = true;
  while (visible < value.length && cursor < end) {
    if (beginningLine && !['inlineCode', 'image', 'imageReference'].includes(node.type)) {
      const rawLine = source.slice(cursor, end).split(/\r\n|\r|\n/, 1)[0];
      const visibleLine = value.slice(visible).split(/\r\n|\r|\n/, 1)[0];
      const normalized = code ? rawLine : decodeString(rawLine);
      if (normalized.endsWith(visibleLine)) {
        // Container markers and indentation are outside the parsed line.
        const prefixLength = normalized.length - visibleLine.length;
        if (!/^[ >\t]*$/.test(rawLine.slice(0, prefixLength))) return [];
        cursor += prefixLength;
      }
      beginningLine = false;
    }
    const rawStart = cursor;
    let token = source[cursor];
    let rawEnd = cursor + 1;
    if (token === '\r' && (node.type === 'inlineCode' || !value.startsWith('\r', visible))) {
      token = '\n';
      if (source[rawEnd] === '\n') rawEnd++;
    } else if (!code && token === '\\' && /[!-/:-@[-\x60{-~]/.test(source[rawEnd] ?? '')) {
      token = source[rawEnd];
      rawEnd++;
    } else if (!code && token === '&') {
      const reference = /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);/.exec(
        source.slice(cursor, end),
      )?.[0];
      if (reference) {
        token = decodeString(reference);
        rawEnd = cursor + reference.length;
      }
    }
    if (node.type === 'inlineCode' && token === '\n') token = ' ';
    if (value.startsWith(token, visible)) {
      const atomic = source.slice(rawStart, rawEnd) !== token;
      const previous = runs.at(-1);
      if (previous && !previous.atomic && !atomic && previous.end === rawStart) {
        previous.text += token;
        previous.end = rawEnd;
      } else
        runs.push({ text: token, start: rawStart, end: rawEnd, ...(atomic ? { atomic } : {}) });
      visible += token.length;
      if (token === '\n' || token === '\r') beginningLine = true;
    } else return [];
    cursor = rawEnd;
  }
  // Never invent a source mapping if the parser produced an unexpected form.
  return visible === value.length ? runs : [];
}

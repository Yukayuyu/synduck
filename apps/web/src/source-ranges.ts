// Rendered Markdown has fewer characters than its immutable source. Each leaf
// records the original UTF-16 range; decoded entities/escapes are atomic leaves.
export type TextRange = { start: number; end: number };
export type SourceRun = TextRange & { text: string; atomic?: boolean };

export function selectionSource(element: HTMLElement, range: Range, source: string) {
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  for (const unknown of element.querySelectorAll('[data-source-unmapped]')) {
    if (range.intersectsNode(unknown)) return null;
  }
  const mapped = element.querySelectorAll<HTMLElement>('[data-source-start]');
  if (!mapped.length) {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const exact = range.toString();
    return exact && source.slice(start, start + exact.length) === exact
      ? { start, end: start + exact.length, exact }
      : null;
  }
  let start: number | undefined;
  let end: number | undefined;
  for (const span of mapped) {
    if (!range.intersectsNode(span)) continue;
    const leaf = document.createRange();
    leaf.selectNodeContents(span);
    const overlap = range.cloneRange();
    if (leaf.compareBoundaryPoints(Range.START_TO_START, range) > 0)
      overlap.setStart(leaf.startContainer, leaf.startOffset);
    if (leaf.compareBoundaryPoints(Range.END_TO_END, range) < 0)
      overlap.setEnd(leaf.endContainer, leaf.endOffset);
    if (!overlap.toString()) continue;
    const prefix = leaf.cloneRange();
    prefix.setEnd(overlap.startContainer, overlap.startOffset);
    const suffix = leaf.cloneRange();
    suffix.setEnd(overlap.endContainer, overlap.endOffset);
    const rawStart = Number(span.dataset.sourceStart);
    const rawEnd = Number(span.dataset.sourceEnd);
    start ??= span.dataset.sourceAtomic ? rawStart : rawStart + prefix.toString().length;
    end = span.dataset.sourceAtomic ? rawEnd : rawStart + suffix.toString().length;
  }
  return start !== undefined && end !== undefined && end > start
    ? { start, end, exact: source.slice(start, end) }
    : null;
}

function textPoint(element: Element, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (offset <= length) return { node, offset };
    offset -= length;
  }
  return null;
}

export function sourceDomRange(element: HTMLElement, start: number, end: number): Range | null {
  const mapped = [...element.querySelectorAll<HTMLElement>('[data-source-start]')];
  const range = document.createRange();
  if (mapped.length) {
    const spans = mapped.filter(
      (span) => Number(span.dataset.sourceEnd) > start && Number(span.dataset.sourceStart) < end,
    );
    const first = spans[0];
    const last = spans.at(-1);
    if (!first || !last) return null;
    const a = textPoint(
      first,
      first.dataset.sourceAtomic ? 0 : Math.max(0, start - Number(first.dataset.sourceStart)),
    );
    const b = textPoint(
      last,
      last.dataset.sourceAtomic
        ? (last.textContent?.length ?? 0)
        : Math.min(last.textContent?.length ?? 0, end - Number(last.dataset.sourceStart)),
    );
    if (!a || !b) return null;
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }
  const a = textPoint(element, start);
  const b = textPoint(element, end);
  if (!a || !b) return null;
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

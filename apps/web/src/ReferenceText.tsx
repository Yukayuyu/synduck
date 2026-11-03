import { useEffect, useRef, useState } from 'react';
import type { ContentBlock } from '@acc/domain';
import { MessageText, SourceText } from './MessageText';
export function ReferenceText({
  block,
  ranges,
  focused,
}: {
  block: ContentBlock;
  ranges: { start: number; end: number }[];
  focused: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);
  const text = block.text_content ?? '';
  const [page, setPage] = useState(0),
    [query, setQuery] = useState(''),
    [match, setMatch] = useState<number | null>(null);
  const size = 20000,
    total = Math.max(1, Math.ceil(text.length / size));
  useEffect(() => {
    if (focused && ranges[0]) setPage(Math.floor(ranges[0].start / size));
  }, [focused, ranges[0]?.start]);
  useEffect(() => {
    if (!focused) return;
    const frame = requestAnimationFrame(() => {
      const mark = body.current?.querySelector('mark');
      const scroll = body.current?.closest<HTMLElement>('.reference-scroll');
      if (mark && scroll) {
        const rect = scroll.getBoundingClientRect();
        const scale = rect.height / scroll.offsetHeight;
        if (scale > 0)
          scroll.scrollTop += (mark.getBoundingClientRect().top - rect.top) / scale - 12;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page, focused, ranges[0]?.start]);
  if (text.length <= 40000)
    return (
      <MessageText
        text={text}
        markdown={block.block_type === 'markdown'}
        ranges={ranges}
        focused={focused}
      />
    );
  let start = page * size,
    end = Math.min(text.length, (page + 1) * size);
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) start--;
  if (end < text.length && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
  const visibleRanges = [
    ...ranges,
    ...(match === null ? [] : [{ start: match, end: match + query.length }]),
  ]
    .filter((r) => r.end > start && r.start < end)
    .map((r) => ({
      start: Math.max(0, r.start - start),
      end: Math.min(end - start, r.end - start),
    }));
  return (
    <>
      <div className="reference-pages" data-source-unmapped>
        <input
          aria-label="尋找參考文字"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatch(null);
          }}
        />
        <button
          disabled={!query}
          onClick={() => {
            const from = match === null ? 0 : match + 1;
            let index = text.indexOf(query, from);
            if (index < 0) index = text.indexOf(query);
            setMatch(index < 0 ? null : index);
            if (index >= 0) setPage(Math.floor(index / size));
          }}
        >
          尋找下一個
        </button>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          上一頁
        </button>
        <span>
          {page + 1} / {total}
        </span>
        <button disabled={page + 1 >= total} onClick={() => setPage(page + 1)}>
          下一頁
        </button>
      </div>
      <div ref={body} data-source-start={start} data-source-end={end}>
        <SourceText text={text.slice(start, end)} ranges={visibleRanges} focused={focused} />
      </div>
    </>
  );
}

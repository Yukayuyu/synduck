import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';

export interface SourceAnchor {
  id: string;
  blockId: string;
  start: number;
  end: number;
  quote: boolean;
}

// Resolve UTF-16 offsets against actual rendered text (including highlighted spans).
// Geometry is presentation only; excerpt selectors remain canonical domain data.
export function SourceHandles({
  nodeId,
  container,
  sources,
}: {
  nodeId: string;
  container: RefObject<HTMLElement | null>;
  sources: SourceAnchor[];
}) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const update = useUpdateNodeInternals();
  const frame = useRef(0);
  useLayoutEffect(() => {
    const card = container.current;
    if (!card) return;
    const measure = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const bounds = card.getBoundingClientRect();
        const scale = bounds.width / card.offsetWidth;
        if (!scale) return;
        const next: typeof positions = {};
        for (const source of sources) {
          const block = document.getElementById('block-' + source.blockId);
          if (!block || !card.contains(block)) continue;
          const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          const range = document.createRange();
          let offset = 0,
            startSet = false,
            endSet = false;
          for (let text = walker.nextNode(); text; text = walker.nextNode()) {
            const length = text.textContent?.length ?? 0;
            if (!startSet && source.start <= offset + length) {
              range.setStart(text, Math.max(0, source.start - offset));
              startSet = true;
            }
            if (source.end <= offset + length) {
              range.setEnd(text, Math.max(0, source.end - offset));
              endSet = true;
              break;
            }
            offset += length;
          }
          if (!startSet || !endSet) continue;
          const rects = range.getClientRects();
          const rect = rects[rects.length - 1];
          if (!rect) continue;
          const scroll = block.closest('.conversation-scroll')?.getBoundingClientRect();
          const y = Math.max(
            scroll?.top ?? bounds.top,
            Math.min(scroll?.bottom ?? bounds.bottom, (rect.top + rect.bottom) / 2),
          );
          next[source.id] = {
            x: (rect.right - bounds.left) / scale + 5,
            y: (y - bounds.top) / scale,
          };
        }
        setPositions((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      });
    };
    measure();
    card.addEventListener('scroll', measure, true);
    const resize = new ResizeObserver(measure);
    resize.observe(card);
    const mutation = new MutationObserver(measure);
    mutation.observe(card.querySelector('.card-content') ?? card, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(frame.current);
      resize.disconnect();
      mutation.disconnect();
      card.removeEventListener('scroll', measure, true);
    };
  }, [container, sources]);
  useLayoutEffect(() => {
    if (!Object.keys(positions).length) return;
    const frame = requestAnimationFrame(() => update(nodeId));
    return () => cancelAnimationFrame(frame);
  }, [nodeId, positions, update]);
  return sources.map((source) => {
    const point = positions[source.id];
    return (
      <Handle
        key={source.id}
        id={source.id}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={source.quote ? 'pick-source-handle' : 'fork-source-handle'}
        style={point ? { left: point.x, top: point.y, right: 'auto' } : { opacity: 0 }}
      />
    );
  });
}

import { memo, useMemo, type ReactNode } from 'react';
import type { Nodes, Root } from 'mdast';
import { parseMarkdown, sourceRuns } from './markdown-source';
import type { SourceRun, TextRange } from './source-ranges';
import './message-text.css';

export function SourceText({
  text,
  ranges = [],
  focused = false,
}: {
  text: string;
  ranges?: TextRange[];
  focused?: boolean;
}) {
  if (!ranges.length) return text;
  const points = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.start, r.end])])]
    .filter((n) => n >= 0 && n <= text.length)
    .sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const value = text.slice(start, end);
    if (!ranges.some((r) => r.start < end && r.end > start)) return value;
    return focused ? (
      <mark key={start}>{value}</mark>
    ) : (
      <span className="picked-text" key={start}>
        {value}
      </span>
    );
  });
}

function hasMarkup(node: Nodes, source: string): boolean {
  if (node.type === 'text')
    return node.value !== source.slice(node.position?.start.offset, node.position?.end.offset);
  return (
    !['root', 'paragraph'].includes(node.type) ||
    ('children' in node && node.children.some((child) => hasMarkup(child, source)))
  );
}

export function safeMarkdownUrl(value: string) {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value, 'https://canvas.invalid/');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function MappedText({
  run,
  ranges,
  focused,
}: {
  run: SourceRun;
  ranges: TextRange[];
  focused: boolean;
}) {
  const points = run.atomic
    ? [run.start, run.end]
    : [...new Set([run.start, run.end, ...ranges.flatMap((r) => [r.start, r.end])])]
        .filter((n) => n >= run.start && n <= run.end)
        .sort((a, b) => a - b);
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const value = run.atomic ? run.text : run.text.slice(start - run.start, end - run.start);
    const picked = ranges.some((r) => r.start < end && r.end > start);
    return (
      <span
        key={start}
        data-source-start={start}
        data-source-end={end}
        data-source-atomic={run.atomic || undefined}
      >
        {picked ? (
          focused ? (
            <mark>{value}</mark>
          ) : (
            <span className="picked-text">{value}</span>
          )
        ) : (
          value
        )}
      </span>
    );
  });
}

function MessageBody({
  text,
  markdown = true,
  ranges = [],
  focused = false,
}: {
  text: string;
  markdown?: boolean;
  ranges?: TextRange[];
  focused?: boolean;
}) {
  const root = useMemo<Root | null>(
    () => (markdown ? parseMarkdown(text) : null),
    [text, markdown],
  );
  if (!root || !hasMarkup(root, text))
    return <SourceText text={text} ranges={ranges} focused={focused} />;
  const definitions = new Map(
    root.children
      .filter((node) => node.type === 'definition')
      .map((node) => [node.identifier, node]),
  );
  const leaves = (node: Nodes) => {
    const runs = sourceRuns(text, node);
    if (!runs.length && 'value' in node && node.value)
      return <span data-source-unmapped>{node.value}</span>;
    return runs.map((run) => (
      <MappedText key={run.start} run={run} ranges={ranges} focused={focused} />
    ));
  };
  const render = (node: Nodes, key: number): ReactNode => {
    const children = 'children' in node && node.type !== 'table' ? node.children.map(render) : null;
    switch (node.type) {
      case 'root':
        return children;
      case 'text':
        return <span key={key}>{leaves(node)}</span>;
      case 'paragraph':
        return <p key={key}>{children}</p>;
      case 'heading': {
        const Tag = ('h' + node.depth) as 'h1';
        return <Tag key={key}>{children}</Tag>;
      }
      case 'strong':
        return <strong key={key}>{children}</strong>;
      case 'emphasis':
        return <em key={key}>{children}</em>;
      case 'delete':
        return <del key={key}>{children}</del>;
      case 'inlineCode':
        return <code key={key}>{leaves(node)}</code>;
      case 'code':
        return (
          <pre
            key={key}
            className="nowheel"
            tabIndex={0}
            aria-label={node.lang ? node.lang + ' 代码' : '代码'}
          >
            <code>{leaves(node)}</code>
          </pre>
        );
      case 'blockquote':
        return <blockquote key={key}>{children}</blockquote>;
      case 'list':
        return node.ordered ? (
          <ol key={key} start={node.start ?? 1}>
            {children}
          </ol>
        ) : (
          <ul key={key}>{children}</ul>
        );
      case 'listItem':
        return (
          <li key={key}>
            {typeof node.checked === 'boolean' && (
              <input
                type="checkbox"
                checked={node.checked}
                disabled
                readOnly
                aria-label="任务状态"
              />
            )}
            {children}
          </li>
        );
      case 'link':
      case 'linkReference': {
        const destination = node.type === 'link' ? node : definitions.get(node.identifier);
        return (
          <a
            key={key}
            href={safeMarkdownUrl(destination?.url ?? '')}
            title={destination?.title ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        );
      }
      case 'image':
      case 'imageReference': {
        const destination = node.type === 'image' ? node : definitions.get(node.identifier);
        return (
          <a
            key={key}
            href={safeMarkdownUrl(destination?.url ?? '')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {node.alt ? leaves(node) : '图片'}
          </a>
        );
      }
      case 'table':
        return (
          <div key={key} className="markdown-table nowheel">
            <table>
              <thead>
                <tr>
                  {node.children[0]?.children.map((cell, index) => (
                    <th key={index} style={{ textAlign: node.align?.[index] ?? undefined }}>
                      {cell.children.map(render)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {node.children.slice(1).map((row, index) => (
                  <tr key={index}>
                    {row.children.map((cell, column) => (
                      <td key={column} style={{ textAlign: node.align?.[column] ?? undefined }}>
                        {cell.children.map(render)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'break':
        return <br key={key} />;
      case 'thematicBreak':
        return <hr key={key} />;
      case 'html':
        return <span key={key}>{leaves(node)}</span>;
      case 'definition':
        return null;
      default:
        return children;
    }
  };
  return <div className="markdown-body">{root.children.map(render)}</div>;
}

export const MessageText = memo(
  MessageBody,
  (before, after) =>
    before.text === after.text &&
    (before.markdown ?? true) === (after.markdown ?? true) &&
    (before.focused ?? false) === (after.focused ?? false) &&
    (before.ranges?.length ?? 0) === (after.ranges?.length ?? 0) &&
    (before.ranges ?? []).every(
      (range, index) =>
        range.start === after.ranges?.[index].start && range.end === after.ranges?.[index].end,
    ),
);

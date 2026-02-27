'use client';

import { MarkdownViewer } from './MarkdownViewer';
import { useCallback } from 'react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Markdown note...',
}: MarkdownEditorProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        style={{
          minHeight: '80px',
          padding: '8px',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          resize: 'vertical',
          fontSize: '14px',
          fontFamily: 'Menlo, Monaco, monospace',
          lineHeight: 1.4,
          backgroundColor: 'var(--panel)',
        }}
      />
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '8px',
        maxHeight: '120px',
        overflowY: 'auto',
        backgroundColor: 'var(--panel)',
        lineHeight: 1.4,
        fontSize: '14px',
      }}>
        <MarkdownViewer text={value} />
      </div>
    </div>
  );
}
'use client';

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';

interface MarkdownViewerProps {
  text: string;
  className?: string;
}

export function MarkdownViewer({ text, className = '' }: MarkdownViewerProps) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    if (!text.trim()) {
      setHtml('');
      return;
    }
    (marked.parse(text, { breaks: true }) as Promise<string>).then((rawHtml) => {
      setHtml(DOMPurify.sanitize(rawHtml));
    });
  }, [text]);

  return (
    <div
      className={className}
      style={{
        lineHeight: 1.4,
        fontSize: '14px',
        maxWidth: '280px',
        wordBreak: 'break-word',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

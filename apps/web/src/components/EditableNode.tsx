'use client';

import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from 'reactflow';

export type EditableNodeData = {
  label: string;
  editing?: boolean;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
};

export function EditableNode({ data, selected }: NodeProps<EditableNodeData>) {
  const [value, setValue] = useState(data.label || '');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data.editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [data.editing]);

  const commit = () => {
    const v = value.trim();
    if (!v) {
      data.onCancel?.();
      return;
    }
    data.onCommit?.(v);
  };

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 12,
        background: 'var(--panel)',
        border: selected ? '2px solid #7aa2ff' : '1px solid var(--border)',
        minWidth: 140,
      }}
    >
      {data.editing ? (
        <input
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="word…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') data.onCancel?.();
          }}
          onBlur={() => commit()}
          style={{ width: '100%' }}
        />
      ) : (
        <div style={{ fontWeight: 600 }}>{data.label}</div>
      )}
    </div>
  );
}

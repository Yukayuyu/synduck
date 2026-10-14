import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  run: () => void;
}
export function ContextMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const [position, setPosition] = useState({ x, y });
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('canvas-view-changed', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('canvas-view-changed', close);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="canvas-context-menu nokey"
      role="menu"
      aria-label="畫布操作"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected)
            previousFocus.current.focus();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = [
            ...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[index]?.focus();
        } else if (event.key === 'Tab') onClose();
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          className={(action.danger ? 'danger ' : '') + (action.divider ? 'menu-divider' : '')}
          onClick={() => {
            onClose();
            action.run();
          }}
        >
          {action.icon}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

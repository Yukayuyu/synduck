import { z } from 'zod';
import type { ReactNode } from 'react';
import type { ForkDraft } from './Focus';
import type { SelectedText } from './Focus';
import type { ExternalOrigin } from '@acc/domain';

const Drafts = z.object({
  prompts: z.record(z.string(), z.string().max(32000)),
  forkDrafts: z.record(
    z.string(),
    z
      .array(
        z.object({
          id: z.string().uuid(),
          mode: z.enum(['fork', 'btw']),
          prompt: z.string().max(32000),
        }),
      )
      .max(8),
  ),
});
export type CanvasDrafts = z.infer<typeof Drafts>;
export const draftsKey = (id: string) => 'canvas-drafts-v1:' + id;
export function readDrafts(id: string): CanvasDrafts {
  try {
    const raw = localStorage.getItem(draftsKey(id));
    if (raw) return Drafts.parse(JSON.parse(raw));
  } catch {
    /* Keep the original storage untouched until an explicit edit. */
  }
  return { prompts: {}, forkDrafts: {} };
}
export function writeDrafts(
  id: string,
  prompts: Record<string, string>,
  forkDrafts: Record<string, ForkDraft[]>,
) {
  localStorage.setItem(draftsKey(id), JSON.stringify({ prompts, forkDrafts }));
}
export function hasDrafts(id: string) {
  const drafts = readDrafts(id);
  return (
    Object.values(drafts.prompts).some((text) => text.trim()) ||
    Object.values(drafts.forkDrafts).some((entries) => entries.length)
  );
}
export interface CanvasView {
  activeId: string | null;
  selected: string[];
  budget: number;
  viewport?: { x: number; y: number; zoom: number };
}
export interface CanvasSession {
  id: string;
  visible: boolean;
  globalBusy: boolean;
  globalDirty: boolean;
  switcher: ReactNode;
  initialView?: CanvasView;
  onView: (id: string, view: CanvasView) => void;
  onRuntime: (id: string, state: { busy: boolean; dirty: boolean }) => void;
  onCatalogChange: () => void;
  navigation?: { token: string; nodeId?: string; origin?: ExternalOrigin };
  onNavigated: (token: string) => void;
  onReference: (selection: SelectedText) => void;
  onSourceJump: (origin: ExternalOrigin) => void;
}

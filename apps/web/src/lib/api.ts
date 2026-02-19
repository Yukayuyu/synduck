import { config, requireEnv } from '@/lib/config';
import { getIdToken } from '@/lib/auth';

function apiBase() {
  const base = requireEnv('NEXT_PUBLIC_API_BASE_URL', config.apiBaseUrl);
  return base.replace(/\/$/, '');
}

function authHeader(): Record<string, string> {
  const token = getIdToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export type NodeItem = { id: string; label: string; note?: string; createdAt?: string };
export type EdgeItem = { id: string; from: string; to: string; note?: string; createdAt?: string };

export async function fetchNodes(): Promise<NodeItem[]> {
  const res = await fetch(`${apiBase()}/nodes`, { cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as { items?: NodeItem[] };
  return json.items || [];
}

export async function createNode(input: { label: string; note?: string }) {
  const res = await fetch(`${apiBase()}/nodes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json as { ok: true; id: string };
}

export async function fetchEdges(): Promise<EdgeItem[]> {
  const res = await fetch(`${apiBase()}/edges`, { cache: 'no-store' });
  const json = (await res.json().catch(() => ({}))) as { items?: EdgeItem[] };
  return json.items || [];
}

export async function createEdge(input: { from: string; to: string; note?: string }) {
  const res = await fetch(`${apiBase()}/edges`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader(),
    },
    body: JSON.stringify(input),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json as { ok: true; id: string };
}

export async function deleteEdge(input: { from: string; to: string }) {
  const qs = new URLSearchParams({ from: input.from, to: input.to });
  const res = await fetch(`${apiBase()}/edges?${qs.toString()}`, {
    method: 'DELETE',
    headers: {
      ...authHeader(),
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json as { ok: true; id: string };
}

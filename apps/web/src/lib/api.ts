import { config, requireEnv } from '@/lib/config';
import { getIdToken, getGuestToken, setGuestToken } from '@/lib/auth';

function apiBase() {
  const base = requireEnv('NEXT_PUBLIC_API_BASE_URL', config.apiBaseUrl);
  return base.replace(/\/$/, '');
}

function authHeader(): Record<string, string> {
  const idToken = getIdToken();
  const guestToken = getGuestToken();
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.authorization = `Bearer ${idToken}`;
  } else if (guestToken) {
    headers['x-guest-token'] = guestToken;
  }
  return headers;
}

export const EDGE_TYPES = ['depends_on', 'references', 'related_to', 'causes'] as const;

export type NodeItem = { id: string; label: string; note?: string; createdAt?: string };
export type EdgeItem = {
  id: string;
  from: string;
  to: string;
  note?: string;
  type?: string;
  annotation?: string;
  createdAt?: string;
};
export type GraphItem = {
  id: string;
  name: string;
  visibility: 'public' | 'private';
  owner: string;
  createdAt: string;
  userRole?: string | null;
};
export type GraphDetail = GraphItem & { shareToken?: string; permissions?: Record<string, string> };

export async function createGuestSession(): Promise<{ token: string }> {
  const res = await fetch(`${apiBase()}/guest/session`, {
    method: 'POST',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  setGuestToken(json.token);
  return json;
}

export async function fetchGraphs(type: 'my' | 'public' = 'my'): Promise<GraphItem[]> {
  const qs = new URLSearchParams({ type });
  if (getGuestToken()) {
    qs.append('guestToken', getGuestToken()!);
  }
  const res = await fetch(`${apiBase()}/graphs?${qs}`, {
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.items || [];
}

export async function fetchGraph(graphId: string, shareToken?: string): Promise<GraphDetail> {
  const qs = new URLSearchParams({ id: graphId });
  if (shareToken) qs.append('shareToken', shareToken);
  const res = await fetch(`${apiBase()}/graphs?${qs}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.graph;
}

export async function createGraph(input: {
  name: string;
  visibility?: 'public' | 'private';
}): Promise<{ id: string }> {
  const res = await fetch(`${apiBase()}/graphs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function deleteGraph(graphId: string): Promise<void> {
  const qs = new URLSearchParams({ id: graphId });
  const res = await fetch(`${apiBase()}/graphs?${qs}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
}

export async function fetchNodes(graphId: string, shareToken?: string): Promise<NodeItem[]> {
  const qs = new URLSearchParams({ graphId });
  if (shareToken) qs.append('shareToken', shareToken);
  const res = await fetch(`${apiBase()}/nodes?${qs}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.items || [];
}

export async function createNode(
  graphId: string,
  input: { label: string; note?: string },
): Promise<{ id: string }> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/nodes?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function fetchEdges(graphId: string, shareToken?: string): Promise<EdgeItem[]> {
  const qs = new URLSearchParams({ graphId });
  if (shareToken) qs.append('shareToken', shareToken);
  const res = await fetch(`${apiBase()}/edges?${qs}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.items || [];
}

export async function createEdge(
  graphId: string,
  input: { from: string; to: string; note?: string; type?: string; annotation?: string },
): Promise<{ id: string }> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/edges?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function updateEdge(
  graphId: string,
  edgeId: string,
  input: { note?: string; type?: string; annotation?: string },
): Promise<{ id: string }> {
  const qs = new URLSearchParams({ graphId, id: edgeId });
  const res = await fetch(`${apiBase()}/edges?${qs}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

export async function deleteEdge(
  graphId: string,
  input: { from: string; to: string },
): Promise<void> {
  const qs = new URLSearchParams({ ...input, graphId });
  const res = await fetch(`${apiBase()}/edges?${qs}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
}

// Permissions management
export async function fetchPermissions(graphId: string): Promise<Record<string, string>> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/permissions?${qs}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.permissions || {};
}

export async function addPermission(
  graphId: string,
  input: { userSub: string; role: 'editor' | 'viewer' },
): Promise<void> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/permissions?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
}

export async function removePermission(graphId: string, userSub: string): Promise<void> {
  const qs = new URLSearchParams({ graphId, userSub });
  const res = await fetch(`${apiBase()}/permissions?${qs}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
}

// Share token management
export async function generateShareToken(graphId: string): Promise<string> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/share?${qs}`, {
    method: 'POST',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.shareToken;
}

export async function revokeShareToken(graphId: string): Promise<void> {
  const qs = new URLSearchParams({ graphId });
  const res = await fetch(`${apiBase()}/share?${qs}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
}

export async function fetchSimilarGraphs(
  graphId: string,
  shareToken?: string,
): Promise<Array<{ id: string; name: string; score: number }>> {
  const qs = new URLSearchParams({ targetGraphId: graphId });
  if (shareToken) qs.append('shareToken', shareToken);
  const res = await fetch(`${apiBase()}/graphs/similar?${qs}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json.items || [];
}

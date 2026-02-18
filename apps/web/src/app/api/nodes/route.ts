import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function apiBase() {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new Error('NEXT_PUBLIC_API_BASE_URL not set');
  return base.replace(/\/$/, '');
}

export async function GET() {
  const res = await fetch(`${apiBase()}/nodes`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

export async function POST(req: Request) {
  const c = await cookies();
  const access = c.get('synduck_access_token')?.value;
  if (!access) {
    return NextResponse.json({ ok: false, error: 'not_logged_in' }, { status: 401 });
  }

  const body = await req.text();

  const res = await fetch(`${apiBase()}/nodes`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${access}`,
    },
    body,
    cache: 'no-store',
  });

  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}

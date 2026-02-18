import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('synduck_access_token', '', { httpOnly: true, path: '/', maxAge: 0 });
  res.cookies.set('synduck_id_token', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

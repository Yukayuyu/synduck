import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const cookie = req.headers.get('cookie') || '';
  const loggedIn = cookie.includes('synduck_id_token=');
  return NextResponse.json({ loggedIn });
}

import { NextResponse } from 'next/server';

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  [k: string]: unknown;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ ok: false, error: 'missing_code' }, { status: 400 });
  }

  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI;

  if (!domain || !clientId || !redirectUri) {
    return NextResponse.json({ ok: false, error: 'missing_env' }, { status: 500 });
  }

  const tokenUrl = `${domain.replace(/\/$/, '')}/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    cache: 'no-store',
  });

  const text = await res.text();
  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    json = { raw: text } as TokenResponse;
  }

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'token_exchange_failed', detail: json }, { status: 502 });
  }

  const accessToken = json.access_token;
  const idToken = json.id_token;

  if (!accessToken || !idToken) {
    return NextResponse.json({ ok: false, error: 'missing_tokens', detail: json }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true });

  // MVP: store tokens in httpOnly cookies so UI can check login state.
  // Later: verify JWTs (issuer/jwks) and proxy write calls server-side.
  response.cookies.set('synduck_access_token', accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60,
  });
  response.cookies.set('synduck_id_token', idToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60,
  });

  return response;
}

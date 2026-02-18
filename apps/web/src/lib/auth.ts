import { config } from '@/lib/config';

const ACCESS_KEY = 'synduck_access_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function setAccessToken(token: string) {
  window.localStorage.setItem(ACCESS_KEY, token);
}

export function clearAccessToken() {
  window.localStorage.removeItem(ACCESS_KEY);
}

export function isLoggedIn(): boolean {
  return !!getAccessToken();
}

function env(name: string): string {
  // For static export, env vars might be missing at build time.
  // Return empty string and let UI show a hint.
  return process.env[name] || '';
}

export function getLoginUrl(): string {
  const domain = (config.cognitoDomain || env('NEXT_PUBLIC_COGNITO_DOMAIN')).replace(/\/$/, '');
  const clientId = config.cognitoClientId || env('NEXT_PUBLIC_COGNITO_CLIENT_ID');
  const redirectUri = config.cognitoRedirectUri || env('NEXT_PUBLIC_COGNITO_REDIRECT_URI');
  if (!domain || !clientId || !redirectUri) return '';

  return `${domain}/login?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=openid+email+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export function getLogoutUrl(): string {
  const domain = (config.cognitoDomain || env('NEXT_PUBLIC_COGNITO_DOMAIN')).replace(/\/$/, '');
  const clientId = config.cognitoClientId || env('NEXT_PUBLIC_COGNITO_CLIENT_ID');
  const logoutUri = process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI || '';
  if (!domain || !clientId || !logoutUri) return '';

  return `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(logoutUri)}`;
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const domain = (config.cognitoDomain || env('NEXT_PUBLIC_COGNITO_DOMAIN')).replace(/\/$/, '');
  const clientId = config.cognitoClientId || env('NEXT_PUBLIC_COGNITO_CLIENT_ID');
  const redirectUri = config.cognitoRedirectUri || env('NEXT_PUBLIC_COGNITO_REDIRECT_URI');
  if (!domain || !clientId || !redirectUri) throw new Error('missing_cognito_env');

  const tokenUrl = `${domain}/oauth2/token`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();
  let json: { access_token?: string; [k: string]: unknown };
  try {
    json = JSON.parse(text) as { access_token?: string; [k: string]: unknown };
  } catch {
    throw new Error(`Token exchange failed: ${text}`);
  }

  if (!res.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }

  return json.access_token;
}

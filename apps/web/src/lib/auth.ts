import { config } from '@/lib/config';

const ACCESS_KEY = 'synduck_access_token';
const ID_KEY = 'synduck_id_token';
const GUEST_KEY = 'synduck_guest_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getIdToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ID_KEY);
}

export function getGuestToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(GUEST_KEY);
}

export function setGuestToken(token: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(GUEST_KEY, token);
  }
}

export function clearGuestToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(GUEST_KEY);
  }
}

export function setTokens(tokens: { accessToken: string; idToken: string }) {
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  window.localStorage.setItem(ID_KEY, tokens.idToken);
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(ID_KEY);
  clearGuestToken();
}

export function clearSession(): void {
  clearTokens();
  clearGuestToken();
}

export function isLoggedIn(): boolean {
  return !!getIdToken();
}

export function hasSession(): boolean {
  return isLoggedIn() || !!getGuestToken();
}

function env(name: string): string {
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

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  [k: string]: unknown;
};

export async function exchangeCodeForTokens(
  code: string,
): Promise<{ accessToken: string; idToken: string }> {
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
  let json: TokenResponse;
  try {
    json = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`Token exchange failed: ${text}`);
  }

  if (!res.ok || !json.access_token || !json.id_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }

  return { accessToken: json.access_token, idToken: json.id_token };
}

export const config = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || '',
  cognitoDomain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '',
  cognitoClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '',
  cognitoRedirectUri: process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI || '',
};

export function requireEnv(name: string, value: string) {
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  // IMPORTANT: CloudFront + S3 origin does not serve /path/ => /path/index.html.
  // Using trailingSlash would cause /auth/callback/?code=... to map to the S3 key "auth/callback/" and return 403.
  // So we keep trailingSlash disabled and use /auth/callback.html as Cognito redirect.
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;

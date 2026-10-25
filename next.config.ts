import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    const headers = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self)' },
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
      },
    ];
    if (process.env.MING_APP_ORIGIN?.startsWith('https://')) {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
    }
    return [{ source: '/:path*', headers }];
  },
  images: {
    domains: ["randomuser.me"],
  },
};

export default nextConfig;

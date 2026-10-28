import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  generateEtags: false,
  // Week 9: browsers must not guess that a JSON answer is something else, and the site is not meant
  // to be shown inside another page.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;

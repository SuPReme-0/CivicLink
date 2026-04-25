// frontend/next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.whatsapp.net' }
    ]
  },
  async rewrites() {
    return [
      { 
        // 🚨 FIX: Ensures Next.js passes the /api/ prefix to FastAPI
        source: '/api/:path*', 
        destination: `${process.env.NEXT_PUBLIC_API_URL}/api/:path*` 
      }
    ];
  }
};

export default nextConfig;
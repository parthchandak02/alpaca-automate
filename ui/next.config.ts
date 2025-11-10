import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Remove Next.js watermark */
  reactStrictMode: true,
  poweredByHeader: false,
  // Completely disable dev indicator in development mode
  devIndicators: false,
  // Static export for Cloudflare Pages
  output: 'export',
  trailingSlash: true,
};

export default nextConfig;

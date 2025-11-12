import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Remove Next.js watermark */
  reactStrictMode: true,
  poweredByHeader: false,
  // Completely disable dev indicator in development mode
  devIndicators: false,
  // Note: output: 'export' is removed because middleware requires a server
  // If static export is needed, authentication must be handled differently
  trailingSlash: true,
};

export default nextConfig;

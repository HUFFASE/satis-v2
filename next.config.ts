import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Next.js 16: serverActions üst düzeyde; experimental yedek olarak tutuldu
  serverActions: {
    bodySizeLimit: "15mb",
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;

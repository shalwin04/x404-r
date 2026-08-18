import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Remove standalone for Vercel - it handles deployment itself
  // output: "standalone" is only for Docker/self-hosting
};

export default nextConfig;

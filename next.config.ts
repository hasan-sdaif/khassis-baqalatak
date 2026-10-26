import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Keep type errors visible; builds must not silently ship broken TypeScript. */
  reactStrictMode: false,
};

export default nextConfig;

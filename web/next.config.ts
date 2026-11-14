import type { NextConfig } from "next";

// Static export: the explorer is plain HTML/JS + JSON, so it hosts free on Vercel with no server.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

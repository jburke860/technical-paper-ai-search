import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export served by the Cloudflare Worker's free static assets;
  // no Node server or third-party host is involved in production.
  output: "export",
};

export default nextConfig;

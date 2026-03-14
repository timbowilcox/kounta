import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kounta/sdk", "@kounta/core"],
};

export default nextConfig;

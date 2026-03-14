import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kounta/core", "@kounta/sdk"],
};

export default nextConfig;

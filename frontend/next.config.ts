import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  transpilePackages: ["@zvault/sdk"],
  webpack: (config, { isServer }) => {
    config.resolve.symlinks = false;
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
    };
    if (!isServer) {
      config.output = {
        ...config.output,
        environment: {
          ...config.output?.environment,
          asyncFunction: true,
        },
      };
      // Polyfill Node.js modules for browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;

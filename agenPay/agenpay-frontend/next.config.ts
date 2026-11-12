import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    turbo: {
      resolveAlias: {
        // WalletConnect (via wagmi/rainbowkit) pulls optional deps a web build
        // doesn't need. Stub them to silence "module not found" noise.
        "@react-native-async-storage/async-storage": "./lib/empty-module.js",
        "pino-pretty": "./lib/empty-module.js",
      },
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
      // optional peers of @coinbase/cdp-sdk (pulled in by wagmi connectors); unused in browser build
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      "@x402/extensions": false,
    }
    return config
  },
};

export default nextConfig;

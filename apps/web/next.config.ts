import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // COOP/COEP headers required for SharedArrayBuffer (Barretenberg WASM multithreading)
  async headers() {
    return [
      {
        source: '/participate/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },

  webpack(config) {
    // Allow importing compiled Noir ACIR JSON artifacts
    config.module.rules.push({
      test: /\.json$/,
      include: /circuits/,
      type: 'javascript/auto',
      use: [],
    });

    // Required for Barretenberg WASM
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    return config;
  },

  // Disable x-powered-by header
  poweredByHeader: false,

  // Strict mode for better dev experience
  reactStrictMode: true,
};

export default nextConfig;

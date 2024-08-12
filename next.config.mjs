/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Enable tree shaking by ensuring that only the used exports are retained in the final bundle
    config.optimization.usedExports = true;

    // Enable minification to reduce the size of JavaScript files by removing unnecessary code
    config.optimization.minimize = true;

    return config;
  },

  async rewrites() {
    return [
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        pathname: '**',
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  staticPageGenerationTimeout: 180,
};

export default nextConfig;

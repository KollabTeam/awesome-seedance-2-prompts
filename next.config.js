/**
 * Next.js configuration for the standalone seedance-2-prompts landing page project.
 * It is used by local development and production builds; the public app exposes one marketing route while keeping
 * the asset prefix separate from any host site that may mount this project behind a reverse proxy.
 */
const assetPrefix = (process.env.NEXT_PUBLIC_ASSET_PREFIX || '/landing-pages-static').replace(/\/$/, '');
const appEnv = process.env.VITE_APP_ENV || (process.env.NODE_ENV === 'development' ? 'local' : 'production');
const isLocalDebugRuntime = appEnv === 'local';
const nextStaticCacheControl = isLocalDebugRuntime ? 'no-store, max-age=0, must-revalidate' : 'public, max-age=31536000, immutable';
const landingPageSource = '/:landingPageSlug(seedance-2-prompts)';
const localizedPageSource = '/:lang(en|zh-CN|zh-TW|ja|ko|fr|de|ru|pt-BR)/:landingPageSlug(seedance-2-prompts)';
const localDebugNoStoreHeaders = isLocalDebugRuntime
  ? [
      {
        key: 'Cache-Control',
        value: 'no-store, max-age=0, must-revalidate',
      },
      {
        key: 'Pragma',
        value: 'no-cache',
      },
      {
        key: 'Expires',
        value: '0',
      },
      {
        key: 'Clear-Site-Data',
        value: '"cache"',
      },
    ]
  : [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  assetPrefix,
  trailingSlash: false,
  async redirects() {
    return [
      {
        source: '/:landingPageSlug(seedance-2-prompts)/:lang(en|zh-CN|zh-TW|ja|ko|fr|de|ru|pt-BR)',
        destination: '/:lang/:landingPageSlug',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return assetPrefix
      ? [
          {
            source: assetPrefix + '/:path*',
            destination: '/:path*',
          },
        ]
      : [];
  },
  async headers() {
    return [
      {
        source: '/:path*{/}?',
        headers: [
          {
            key: 'X-Accel-Buffering',
            value: 'no',
          },
        ],
      },
      ...(isLocalDebugRuntime
        ? [
            {
              source: '/',
              headers: localDebugNoStoreHeaders,
            },
            {
              source: landingPageSource,
              headers: localDebugNoStoreHeaders,
            },
            {
              source: localizedPageSource,
              headers: localDebugNoStoreHeaders,
            },
          ]
        : []),
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: nextStaticCacheControl,
          },
        ],
      },
      {
        source: assetPrefix + '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: nextStaticCacheControl,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

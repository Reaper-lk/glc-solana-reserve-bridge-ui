import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * The Content Security Policy is NOT here. It carries a per-request nonce and
 * therefore has to be built per request, which `middleware.ts` does. Setting a
 * second, static CSP here would be enforced alongside it as an intersection —
 * the two would have to agree forever, and the day they stopped agreeing the
 * symptom would be a blank page.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Dev-server-only (a no-op in production/`next build`): Next 16 blocks
  // cross-origin requests to its own dev assets by default. Local E2E runs
  // and this box's own tooling reach the dev server via 127.0.0.1 rather
  // than localhost, which trips that block without this. The box's public
  // IP is included too, since manual browser verification happens against
  // that address rather than through a loopback tunnel.
  allowedDevOrigins: ["127.0.0.1", "localhost", "5.78.77.80"],

  typescript: {
    // A type error is a build failure. Never relaxed.
    ignoreBuildErrors: false,
  },

  async rewrites() {
    return [
      /*
       * `/favicon.ico` returned the 404 page. The app declares its icon with
       * `<link rel="icon" href="/icon.png">`, which is what browsers use, but
       * the legacy well-known path is still requested unprompted — by older
       * clients, by link unfurlers, and by the automated reviewers that fetch
       * a signing surface's standard assets before deciding what it is. A
       * rewrite serves the same 512px mark there rather than an HTML error
       * page; it is not a redirect, so nothing observes a second origin.
       */
      { source: "/favicon.ico", destination: "/icon.png" },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

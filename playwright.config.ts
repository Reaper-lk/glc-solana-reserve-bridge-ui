import { defineConfig, devices } from "@playwright/test";

// Overridable so a local run doesn't collide with a `next dev` server
// someone already has open on the default port.
const PORT = Number(process.env.E2E_PORT ?? 3000);
const INTERCEPT_PORT = Number(process.env.E2E_INTERCEPT_PORT ?? 3001);

const baseURL = `http://127.0.0.1:${PORT}`;
const interceptBaseURL = `http://127.0.0.1:${INTERCEPT_PORT}`;

/**
 * Backend origin the "intercepted" server is configured to call. Nothing
 * ever listens here on purpose: the browser's requests are answered
 * entirely by `page.route` (with CORS headers, since this is a distinct
 * origin from the app itself — see tests/e2e/intercepted-helpers.ts), and
 * the app's own server-side SSR fetch to this same URL (in app/layout.tsx)
 * fails fast with ECONNREFUSED rather than hanging.
 *
 * A same-origin path (e.g. this app's own port with a `/__mock_api` path)
 * was tried first and rejected: Next.js dev mode serializes a server
 * component's self-fetch back to its own origin behind the same request
 * queue that is still rendering the page issuing it, so every SSR call
 * took ~15s to resolve even as a 404 — plainly unusable for tests.
 */
const UNUSED_PORT = 9999;
export const INTERCEPTED_API_ORIGIN = `http://127.0.0.1:${UNUSED_PORT}`;

/**
 * Real-backend integration project (tests/e2e/real-backend/). Opt-in only:
 * unlike every other project here, this one talks to an actual running
 * instance of the bridge service (a local regtest Goldcoin node + a local
 * Solana test-validator + `glc-bridge-daemon`, per docs in that directory)
 * rather than fixtures or `page.route` interception, so it cannot be part of
 * the default `npm run test:e2e` baseline — there is no way to guarantee
 * that stack is up in every environment this runs in. Set
 * `E2E_REAL_BACKEND_URL` to the URL of a UI instance already configured
 * with `NEXT_PUBLIC_BRIDGE_API_MODE=http` against that real backend; every
 * spec in this project skips itself (not fails) when it is unset.
 */
const realBackendUrl = process.env.E2E_REAL_BACKEND_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "desktop-chromium",
      testIgnore: [/intercepted/, /real-backend\//],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Every screen must work at 360px. Enforced by a dedicated project
      // rather than a single ad-hoc viewport assertion.
      name: "mobile-360",
      testIgnore: [/intercepted/, /real-backend\//],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      // Paused / insufficient-liquidity / malformed-response /
      // backend-unavailable scenarios: this project runs against a server
      // configured for NEXT_PUBLIC_BRIDGE_API_MODE=http, and every spec in
      // it uses page.route to control the response itself.
      name: "intercepted-backend",
      testMatch: /intercepted-.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: interceptBaseURL },
    },
    {
      // See the `realBackendUrl` comment above — opt-in, skips itself when
      // E2E_REAL_BACKEND_URL is unset.
      name: "real-backend",
      testMatch: /real-backend\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: realBackendUrl ?? baseURL },
    },
  ],

  // The real-backend project talks to a UI instance the caller already has
  // running against real infrastructure (see tests/e2e/real-backend/README.md)
  // — it needs neither local server below, and unlike them has no build/dev
  // command that would even produce the right one. E2E_SKIP_LOCAL_SERVERS
  // opts out of both for a `--project=real-backend`-only run.
  webServer: process.env.E2E_SKIP_LOCAL_SERVERS
    ? []
    : [
        {
          command: `npm run start -- --port ${PORT}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          // NEXT_PUBLIC_* values are inlined at build time, so a different
          // mode needs its own dev server rather than reusing the
          // production build.
          command: `npm run dev -- --port ${INTERCEPT_PORT}`,
          url: interceptBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            NEXT_PUBLIC_BRIDGE_API_MODE: "http",
            NEXT_PUBLIC_BRIDGE_API_URL: INTERCEPTED_API_ORIGIN,
            // Configures the wallet layer so SolanaProvider mounts and
            // Wallet Standard discovery runs — required by
            // intercepted-wallet-discovery.spec.ts. Never actually fetched
            // by that spec; discovery is a window-event handshake.
            NEXT_PUBLIC_SOLANA_RPC_URL: "http://127.0.0.1:8899",
          },
        },
      ],
});

import type { Page, Route } from "@playwright/test";
import { INTERCEPTED_API_ORIGIN } from "../../playwright.config";
import * as fixtures from "../../src/lib/api/mock/fixtures";

/**
 * Routes every real endpoint this app calls to a JSON body, matching the
 * exact backend response shapes documented in
 * src/lib/api/schemas/*.ts — these tests run against a real
 * NEXT_PUBLIC_BRIDGE_API_MODE=http build, so the browser's own `fetch`
 * calls are intercepted here rather than anything being simulated
 * client-side.
 *
 * `INTERCEPTED_API_ORIGIN` is a distinct origin from the app itself, so
 * every response needs CORS headers, and every route must also answer the
 * browser's OPTIONS preflight — a real backend behind a reverse proxy would
 * need the same, so this is exercising a real constraint, not test
 * plumbing to work around.
 */

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
};

/** Exported so individual specs can answer a route override with the same CORS/preflight handling. */
export function respondJson(route: Route, body: unknown, status = 200) {
  if (route.request().method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: CORS_HEADERS });
  }
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  });
}

const json = respondJson;

export async function mockHappyBackend(page: Page): Promise<void> {
  await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
    json(
      route,
      fixtures.statusFixture(() => new Date()),
    ),
  );
  // The route registry. Every availability decision in the app reads from
  // here, so an intercepted backend that omitted it would leave every
  // route unselectable — correctly, since unknown availability fails
  // closed, but for a reason unrelated to what these specs are testing.
  await page.route(`${INTERCEPTED_API_ORIGIN}/chains`, (route) =>
    json(
      route,
      fixtures.chainsFixture(() => new Date()),
    ),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/limits`, (route) =>
    json(route, fixtures.limitsFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/reserve`, (route) =>
    json(route, fixtures.reserveFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/health`, (route) =>
    json(route, fixtures.healthFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/stats`, (route) =>
    json(route, fixtures.statsFixture()),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/quote`, async (route) => {
    if (route.request().method() === "OPTIONS") return json(route, null);
    const body = route.request().postDataJSON() as {
      direction: "GlcToSol" | "SolToGlc";
      gross_amount: number;
    };
    const fee = Math.floor((body.gross_amount * 100) / 10_000);
    await json(route, {
      direction: body.direction,
      gross_amount: body.gross_amount,
      gross_display_amount: (body.gross_amount / 1e8).toFixed(8),
      fee_bps: 100,
      fee_amount: fee,
      fee_display_amount: (fee / 1e8).toFixed(8),
      net_amount: body.gross_amount - fee,
      net_display_amount: ((body.gross_amount - fee) / 1e8).toFixed(8),
      source_decimals: body.direction === "GlcToSol" ? 8 : 6,
      destination_decimals: body.direction === "GlcToSol" ? 6 : 8,
      source_asset: body.direction === "GlcToSol" ? "GLC (Goldcoin)" : "GLC (Solana)",
      destination_asset:
        body.direction === "GlcToSol" ? "GLC (Solana)" : "GLC (Goldcoin)",
    });
  });
  await page.route(`${INTERCEPTED_API_ORIGIN}/transfers/**`, (route) =>
    json(route, fixtures.transfersFixture()[0]),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
    if (route.request().method() === "OPTIONS") return json(route, null);
    if (route.request().method() === "POST") {
      return json(
        route,
        {
          request_id: 4242,
          deposit_address: "GLCVau1t111111111111111111111111111111111",
        },
        201,
      );
    }
    return json(route, {
      items: fixtures.transfersFixture(),
      next_cursor: null,
      as_of: 0,
    });
  });
  // The rolling-24h wallet eligibility check every route's submit gate
  // requires. Two shapes, because the backend has two: the per-route
  // `/recipients/*-to-glc/eligibility` pair, and the route-agnostic
  // `/eligibility` this UI attempts for the other four.
  //
  // A "happy" backend answers them, exactly as it answers `/status` and
  // `/limits`. Omitting them would leave every route unsubmittable —
  // correctly, since an unestablished verdict fails closed, but for a
  // reason unrelated to what these specs test. The blocked and
  // unpublished shapes are asserted by unit tests and by
  // intercepted-failures' own per-spec routes.
  const recipientEligibility = (direction: "SolToGlc" | "RhnToGlc", url: URL) => ({
    direction,
    address: url.searchParams.get("address") ?? "",
    wallet: url.searchParams.get("wallet"),
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    source_wallet_retry_after: null,
    recipient_retry_after: null,
    window_seconds: 86_400,
  });
  await page.route(
    `${INTERCEPTED_API_ORIGIN}/recipients/sol-to-glc/eligibility**`,
    (route) => {
      if (route.request().method() === "OPTIONS") return json(route, null);
      return json(
        route,
        recipientEligibility("SolToGlc", new URL(route.request().url())),
      );
    },
  );
  await page.route(
    `${INTERCEPTED_API_ORIGIN}/recipients/rhn-to-glc/eligibility**`,
    (route) => {
      if (route.request().method() === "OPTIONS") return json(route, null);
      return json(
        route,
        recipientEligibility("RhnToGlc", new URL(route.request().url())),
      );
    },
  );
  // The route-generic check, `GET /routes/{route}/eligibility`. The route
  // is in the PATH, and each leg comes back as an object or as `null`
  // when it was not asked about — the deployed backend's shape.
  await page.route(`${INTERCEPTED_API_ORIGIN}/routes/*/eligibility**`, (route) => {
    if (route.request().method() === "OPTIONS") return json(route, null);
    const url = new URL(route.request().url());
    const routeId = url.pathname.split("/").at(-2) ?? "";
    const source = url.searchParams.get("source");
    const destination = url.searchParams.get("destination");
    // Echoed canonicalized, as the backend does: an EVM address comes
    // back lowercase whatever was sent. That exercises the caller's
    // stale-answer check rather than defeating it.
    const leg = (address: string) => ({
      address: address.startsWith("0x") ? address.toLowerCase() : address,
      eligible: true,
      reason: null,
      retry_after: null,
      retry_after_seconds: null,
    });
    return json(route, {
      route: routeId,
      // A Goldcoin-sourced route is funded by sending to an address the
      // backend issues, so the client sends no `?source=` and this leg is
      // `null`. Not a clearance — a side with no wallet to ask about.
      source: source === null ? null : leg(source),
      destination: destination === null ? null : leg(destination),
      eligible: true,
      blocked_reason: null,
      blocked_reasons: [],
      retry_after: null,
      retry_after_seconds: null,
      window_seconds: 86_400,
      as_of: 0,
    });
  });
  await page.route(`${INTERCEPTED_API_ORIGIN}/explorer/events`, (route) =>
    json(route, { items: fixtures.explorerEventsFixture(), next_cursor: null, as_of: 0 }),
  );
  await page.route(`${INTERCEPTED_API_ORIGIN}/reserves/history`, (route) =>
    json(route, { items: fixtures.reserveHistoryFixture(), next_cursor: null, as_of: 0 }),
  );
}

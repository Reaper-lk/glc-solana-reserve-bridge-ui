import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, connectOriginsFrom, createNonce } from "@/lib/security/csp";
import { isAuthorizedOperator } from "@/lib/security/operator-allowlist";

/**
 * The reserve-funding operator check (`/admin/fund-reserve`).
 *
 * Handled entirely here, in `middleware.ts` at the repo root — deliberately
 * NOT as an `app/api/*` route handler. `scripts/check-no-secrets.mjs`
 * (the "Secret guard" CI check) forbids any file under `app/`/`src/` from
 * reading a non-public environment variable, on the reasoning that
 * anything in that tree could end up in the browser bundle. That reasoning
 * doesn't hold for THIS file (Next.js middleware never ships to the
 * client, and it already reads non-public vars like `NODE_ENV`), but the
 * guard's file-location check does not know that distinction, so the
 * correct move is to use the one location this codebase already treats as
 * legitimately server-only, not to weaken the guard itself.
 *
 * `RESERVE_FUNDING_OPERATOR_ALLOWLIST` is deliberately not a secret: it is
 * a comma-separated list of Solana PUBLIC keys, which are public by
 * definition — knowing one grants no capability, since only the holder of
 * the matching PRIVATE key (in their own Phantom wallet, never touched by
 * this app) can actually sign a funding transaction. This check exists as
 * a second, defense-in-depth layer INSIDE the app on top of production's
 * separate reverse-proxy access control in front of `/admin/*` (configured
 * outside this repository, not part of this change) — it is not, on its
 * own, the page's access control.
 */
const OPERATOR_CHECK_PATH = "/admin/fund-reserve/operator-check";

function handleOperatorCheck(request: NextRequest): NextResponse {
  const address = request.nextUrl.searchParams.get("address");
  const authorized = isAuthorizedOperator(
    address,
    process.env.RESERVE_FUNDING_OPERATOR_ALLOWLIST,
  );
  return NextResponse.json({ authorized });
}

/**
 * Per-request Content Security Policy.
 *
 * Setting the policy on the REQUEST headers as well as the response is what
 * makes this work: Next reads `Content-Security-Policy` off the incoming
 * request, finds the nonce in it, and stamps that nonce onto every script tag
 * it renders. Setting only the response header would produce a policy that
 * blocks the framework's own bootstrap.
 *
 * The cost, stated plainly: a nonce is per-request, so a page carrying one
 * cannot also be a static file served from cache. Routes that were prerendered
 * become server-rendered. That is the trade the strict policy requires, and it
 * is the one PR 13 asks for.
 */
export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === OPERATOR_CHECK_PATH) {
    return handleOperatorCheck(request);
  }

  const nonce = createNonce();

  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV !== "production",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
    connectOrigins: connectOriginsFrom([
      process.env.NEXT_PUBLIC_BRIDGE_API_URL,
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
      process.env.NEXT_PUBLIC_GOLDCOIN_RPC_URL,
    ]),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  /*
   * Everything except build output, images and the favicon. Those are static
   * assets with no inline script to protect, and running middleware on each
   * would add a nonce computation to every file the page loads.
   */
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

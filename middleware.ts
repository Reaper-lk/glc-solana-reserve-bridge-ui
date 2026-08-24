import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, connectOriginsFrom, createNonce } from "@/lib/security/csp";

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

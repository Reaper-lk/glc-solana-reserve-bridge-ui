import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/config/env";
import { forwardToUpstream } from "@/lib/api/dev-proxy";

/**
 * Local-development-only same-origin proxy to the real bridge backend.
 *
 * The real service (`service/src/api.rs` in glc-solana-reserve-bridge) sets
 * no CORS headers of its own — by design, since it expects a reverse proxy
 * in front of it in any real deployment (see that module's doc comment and
 * `.env.example`'s `NEXT_PUBLIC_BRIDGE_API_URL` note). A browser fetching it
 * directly from a different origin is blocked by the browser itself, not by
 * anything this proxy route works around: this route makes the *frontend's
 * own* fetches same-origin (browser -> this Next.js server -> the real
 * backend) rather than loosening the backend's own security posture, which
 * this UI repo has no authority to do anyway.
 *
 * NOT a production mechanism. Production points `NEXT_PUBLIC_BRIDGE_API_URL`
 * at a real reverse proxy that terminates TLS and sets a real CORS policy in
 * front of the backend; this route exists only so `npm run dev` can reach a
 * locally-running backend without one.
 */

async function handle(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const result = await forwardToUpstream(env.bridgeApiProxyUpstreamUrl ?? null, {
    method: request.method,
    path,
    search: request.nextUrl.search,
    headers: request.headers,
    bodyText: hasBody ? await request.text() : null,
  });

  return new NextResponse(result.bodyText, {
    status: result.status,
    headers: {
      "content-type": result.contentType,
      "cache-control": "no-store",
    },
  });
}

export { handle as GET, handle as POST };

/**
 * Forwarding logic for the local-development-only same-origin bridge proxy
 * (`app/api/bridge/[...path]/route.ts`). Lives here, not in the route file
 * itself, so this remains the only place in the codebase that performs
 * network I/O (see eslint.config.mjs's `no-restricted-globals` boundary) —
 * this is genuine backend traffic, just forwarded rather than consumed
 * directly.
 *
 * See that route file's own doc comment for why this proxy exists: the real
 * backend sets no CORS headers by design, so this makes the browser's own
 * fetches same-origin instead of loosening the backend's posture.
 */

const FORWARDED_REQUEST_HEADERS = ["content-type", "accept"];

export interface ProxyRequest {
  readonly method: string;
  readonly path: readonly string[];
  readonly search: string;
  readonly headers: Headers;
  readonly bodyText: string | null;
}

export interface ProxyResponse {
  readonly status: number;
  readonly contentType: string;
  readonly bodyText: string;
}

export async function forwardToUpstream(
  upstreamBase: string | null,
  request: ProxyRequest,
): Promise<ProxyResponse> {
  if (!upstreamBase) {
    return {
      status: 500,
      contentType: "application/json",
      bodyText: JSON.stringify({
        error:
          "NEXT_PUBLIC_BRIDGE_API_PROXY_UPSTREAM_URL is not configured — this dev proxy has nowhere to forward to.",
      }),
    };
  }

  const upstream = new URL(
    `${upstreamBase.replace(/\/+$/, "")}/${request.path.join("/")}`,
  );
  upstream.search = request.search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      cache: "no-store",
      ...(hasBody && request.bodyText !== null ? { body: request.bodyText } : {}),
    });
  } catch (cause) {
    return {
      status: 502,
      contentType: "application/json",
      bodyText: JSON.stringify({
        error: `Could not reach the local backend at ${upstreamBase}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }),
    };
  }

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "application/json",
    bodyText: await response.text(),
  };
}

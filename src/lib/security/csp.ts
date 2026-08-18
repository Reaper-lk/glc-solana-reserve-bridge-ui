/**
 * Content Security Policy (design spec: PR 13 hardening).
 *
 * Phase 0 shipped `script-src 'self' 'unsafe-inline'` and documented it as
 * temporary, because Next injects its bootstrap and RSC payload inline and a
 * policy that blocks the application is a policy someone turns off. This module
 * replaces it with a per-request nonce, which is the only form of the policy
 * that is both strict and actually enforced.
 *
 * `'strict-dynamic'` accompanies the nonce: Next's bootstrap loads further
 * chunks at runtime, and without it every chunk URL would need enumerating in
 * the policy. With it, scripts the nonced bootstrap loads inherit trust, and
 * scripts injected by anything else — an XSS payload, a compromised extension
 * writing into the DOM — do not.
 *
 * Kept as a pure function of its inputs so the policy can be asserted in unit
 * tests rather than inspected by hand in a browser.
 */

export interface CspOptions {
  readonly nonce: string;
  /** Development needs `'unsafe-eval'` for React Refresh. */
  readonly isDev: boolean;
  /** Origins the browser may talk to, from public configuration. */
  readonly connectOrigins: readonly string[];
}

export function buildCsp({ nonce, isDev, connectOrigins }: CspOptions): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React Refresh evaluates modules at runtime. Never in production.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    /*
     * Styles keep 'unsafe-inline'. Tailwind emits a stylesheet, but Next and
     * React both set inline `style` attributes for layout, and there is no
     * nonce mechanism for those — a nonce covers <style> elements, not the
     * attribute. Removing it here would break rendering while removing no real
     * capability from an attacker, since script execution is already gated.
     */
    "style-src 'self' 'unsafe-inline'",
    // Self-hosted only. The app must never pull fonts from a third-party CDN.
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src ${connectOrigins.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    /*
     * Only in production: this upgrades every http:// subresource request the
     * page makes to https://. localhost/127.0.0.1 are exempt from the upgrade
     * as "potentially trustworthy" origins, but any other host serving this
     * dev server over plain HTTP is not — the browser silently rewrites the
     * stylesheet and script requests to https:// and they fail outright,
     * since the dev server has no TLS listener. Production is always HTTPS,
     * so the upgrade is a no-op there and a real defense against mixed content.
     */
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Origins the browser is permitted to talk to, derived from public config so
 * that no domain is hardcoded. Anything not configured is not reachable.
 */
export function connectOriginsFrom(
  candidates: readonly (string | undefined)[],
): readonly string[] {
  const origins = new Set<string>(["'self'"]);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      origins.add(url.origin);
      // Solana RPC providers upgrade to websockets on the same host.
      origins.add(url.origin.replace(/^http/, "ws"));
    } catch {
      // A malformed URL is reported by src/lib/config/env.ts at runtime with a
      // far better message than a failure here would give.
    }
  }

  return [...origins];
}

/**
 * A fresh nonce.
 *
 * `crypto.getRandomValues` rather than `Math.random`: a predictable nonce is
 * equivalent to no nonce at all, since an injected script could simply carry
 * the value an attacker computed.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

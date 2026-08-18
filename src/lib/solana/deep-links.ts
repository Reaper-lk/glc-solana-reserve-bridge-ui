import { env } from "@/lib/config/env";

/**
 * Wallet deep links (design spec A11).
 *
 * On iOS a wallet cannot inject into Safari or Chrome. The working route is a
 * universal link that reopens THIS page inside the wallet's own in-app browser,
 * where injection does work and the normal connection flow takes over.
 *
 * Two rules are load-bearing here.
 *
 * **The target comes from `env.appUrl`, never from `window.location`.** A user
 * who reached a look-alike domain must not have the look-alike handed to their
 * wallet's in-app browser — that is a materially better position for an
 * attacker than an ordinary browser tab, because the wallet frames it as
 * trusted. The path is taken from the current location; the origin never is.
 *
 * **The vendor bases are wallet metadata, not deployment configuration.** They
 * identify the wallet the way its name and icon do, exactly like the install
 * URLs alongside them. Nothing about the bridge's own domains is hardcoded.
 */

export interface DeepLinkTarget {
  readonly id: string;
  readonly name: string;
  /** Universal link that opens `{url}` inside the wallet's browser. */
  readonly build: (url: string, ref: string) => string;
}

const TARGETS: readonly DeepLinkTarget[] = [
  {
    id: "phantom",
    name: "Phantom",
    build: (url, ref) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`,
  },
  {
    id: "solflare",
    name: "Solflare",
    build: (url, ref) =>
      `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(ref)}`,
  },
];

export interface WalletDeepLink {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/**
 * Build the deep links for the current page.
 *
 * `path` is the in-app route to return to — normally `location.pathname` plus
 * its query. Passing a full URL is rejected rather than trusted, because the
 * whole point is that the origin is ours.
 */
export function buildDeepLinks(path: string): readonly WalletDeepLink[] {
  const origin = env.appUrl.replace(/\/+$/, "");
  const target = `${origin}${normalisePath(path)}`;

  return TARGETS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    url: entry.build(target, origin),
  }));
}

/**
 * Reduce whatever the caller passed to a same-origin path.
 *
 * An absolute URL, a protocol-relative URL, or a backslash-prefixed path could
 * all redirect the deep link off our origin. Each is discarded in favour of the
 * app root — losing the user's place is a small cost; sending them somewhere
 * else entirely is not.
 */
function normalisePath(path: string): string {
  if (path.length === 0) return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return "/";
  if (path.startsWith("//") || path.startsWith("\\")) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

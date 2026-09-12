import { env } from "./env";

/**
 * The dApp's self-declared identity, in the one form automated reviewers read.
 *
 * A Solana wallet does not receive a metadata object from a Wallet Standard
 * dApp the way a WalletConnect peer does. What Phantom, and the domain
 * reputation services it consults, actually have to go on is the page itself:
 * its origin, its title, its declared canonical URL, its icon, and its web
 * manifest. A site that declares none of those is, to a scanner, shaped
 * exactly like a throwaway clone of one that does — which is a bad position
 * for a bridge that asks people to sign token transfers.
 *
 * So this module states the identity once, derives every field from
 * `NEXT_PUBLIC_APP_URL`, and is consumed by `app/layout.tsx` (canonical and
 * Open Graph), `app/manifest.ts` and `app/robots.ts`. Nothing here is
 * decorative and nothing here is a claim the deployment cannot back: the
 * origin is the origin the operator configured, and if that is wrong then
 * every link the app has ever rendered was wrong too.
 *
 * No domain is hardcoded, per `src/lib/config/env.ts`.
 */

export interface SiteIdentity {
  /** Full product name, used as the accessible and social title. */
  readonly name: string;
  /** Home-screen label, where ~12 characters is the practical budget. */
  readonly shortName: string;
  readonly description: string;
  /**
   * The app's canonical origin, scheme and host only — no path, no trailing
   * slash. `NEXT_PUBLIC_APP_URL` is permitted to carry a path; a canonical
   * URL or a manifest `id` that inherited one would name a different app
   * identity than the origin the wallet sees.
   */
  readonly origin: string;
  /** Same-origin path to the 512px PNG mark, served by `app/icon.png`. */
  readonly iconPath: string;
  /** Matches `--color-surface`, so the browser chrome does not flash. */
  readonly themeColor: string;
  readonly backgroundColor: string;
}

export const SITE_NAME = "Goldcoin Reserve Bridge";
export const SITE_SHORT_NAME = "GLC Bridge";
export const SITE_DESCRIPTION =
  "Move existing GLC between the Goldcoin blockchain and other supported rails using pre-funded reserves.";

/** `--color-surface` in the light and dark blocks of `app/globals.css`. */
const THEME_COLOR = "#0e1115";
const BACKGROUND_COLOR = "#ffffff";

const ICON_PATH = "/icon.png";

/**
 * Reduce a configured app URL to a bare origin.
 *
 * Falsy or unparseable input returns the empty string rather than a guess.
 * `env.appUrl` is validated as an absolute URL at startup, so the fallback is
 * unreachable through `siteIdentity` — it exists because this function is the
 * unit under test and a guessed origin is the one failure mode that matters.
 */
export function toOrigin(appUrl: string): string {
  if (!appUrl) return "";
  try {
    return new URL(appUrl).origin;
  } catch {
    return "";
  }
}

export function buildSiteIdentity(appUrl: string): SiteIdentity {
  return {
    name: SITE_NAME,
    shortName: SITE_SHORT_NAME,
    description: SITE_DESCRIPTION,
    origin: toOrigin(appUrl),
    iconPath: ICON_PATH,
    themeColor: THEME_COLOR,
    backgroundColor: BACKGROUND_COLOR,
  };
}

export const siteIdentity: SiteIdentity = buildSiteIdentity(env.appUrl);

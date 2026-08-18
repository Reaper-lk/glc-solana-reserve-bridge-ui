/**
 * Platform detection for wallet connection (design spec A11).
 *
 * A pure function of the user-agent string, deliberately. Detection decides
 * whether we show a working path or a dead button, and a pure function can be
 * tested against real captured user agents rather than against a browser we
 * happen to have installed.
 *
 * The distinction that matters is NOT phone versus desktop. It is: can a wallet
 * inject itself into this browser?
 *
 *   - Desktop browsers: yes, via extension.
 *   - A wallet's own in-app browser: yes, the wallet injects itself.
 *   - Android Chrome: no injection, but the Mobile Wallet Adapter protocol
 *     works, and `WalletProvider` registers it automatically.
 *   - iOS Safari and iOS Chrome: neither. The only route is a deep link that
 *     reopens this page inside the wallet's own browser.
 *
 * That last case is why this file exists. Without it the wallet list reports
 * "not installed" on a phone where the wallet is installed, and sends the user
 * to a download page that cannot help them.
 */

export type WalletPlatform =
  /** Extension injection is possible. Desktop browsers. */
  | "desktop"
  /** Already inside a wallet's in-app browser; injection works. */
  | "wallet-browser"
  /** Android outside a WebView. Mobile Wallet Adapter applies. */
  | "android"
  /** iOS. Deep links into a wallet's in-app browser are the only route. */
  | "ios"
  /** A mobile WebView that is not a known wallet. Nothing will work here. */
  | "unsupported-webview";

export interface PlatformProbe {
  readonly userAgent: string | null;
  /**
   * Whether any non-mobile adapter reports itself installed.
   *
   * A wallet's in-app browser injects exactly like an extension does, so an
   * installed adapter on a phone means we are inside one. This is the same
   * signal `@solana/wallet-adapter-react` uses, and it is more reliable than
   * matching wallet names in the user-agent string, which wallets change.
   */
  readonly hasInjectedWallet: boolean;
}

/**
 * Android WebView and iOS in-app browser markers.
 *
 * Matches the shape `@solana/wallet-adapter-react` uses, so our view of the
 * environment cannot drift from the one that decides whether the Mobile Wallet
 * Adapter gets registered.
 */
const WEBVIEW =
  /(WebView|Version\/.+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+)|; wv\).+(Chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+))/i;

const ANDROID = /android/i;

/**
 * iPadOS 13+ reports a desktop Safari user agent, so `iPad` alone misses it.
 * Callers that care pass `maxTouchPoints`; without it an iPad is treated as
 * desktop, which degrades to the extension path rather than to a dead end.
 */
const IOS = /iphone|ipod|ipad/i;

export function detectPlatform(probe: PlatformProbe): WalletPlatform {
  const { userAgent, hasInjectedWallet } = probe;

  // An injected wallet means injection works, whatever the device claims to
  // be. Checked first because it makes every other branch irrelevant.
  if (hasInjectedWallet) {
    return userAgent && isMobileUserAgent(userAgent) ? "wallet-browser" : "desktop";
  }

  if (!userAgent) return "desktop";

  if (ANDROID.test(userAgent)) {
    // Inside a WebView the Mobile Wallet Adapter cannot complete its
    // round trip, so Android alone is not enough.
    return WEBVIEW.test(userAgent) ? "unsupported-webview" : "android";
  }

  if (IOS.test(userAgent)) return "ios";

  return "desktop";
}

function isMobileUserAgent(userAgent: string): boolean {
  return ANDROID.test(userAgent) || IOS.test(userAgent);
}

/** Whether this platform needs the deep-link flow rather than a wallet list. */
export function needsDeepLink(platform: WalletPlatform): boolean {
  return platform === "ios";
}

/**
 * Whether a wallet reported as "not detected" should be offered for install.
 *
 * False on every mobile platform. A phone user very likely HAS the wallet app;
 * it simply cannot inject into this browser. Offering "Install" there states
 * something we do not know and sends them somewhere that will not help.
 */
export function canOfferInstall(platform: WalletPlatform): boolean {
  return platform === "desktop" || platform === "wallet-browser";
}

/** Read the probe from the browser. The only impure part of this module. */
export function readPlatformProbe(hasInjectedWallet: boolean): PlatformProbe {
  const navigatorRef = globalThis.navigator as Navigator | undefined;
  return {
    userAgent: navigatorRef?.userAgent ?? null,
    hasInjectedWallet,
  };
}

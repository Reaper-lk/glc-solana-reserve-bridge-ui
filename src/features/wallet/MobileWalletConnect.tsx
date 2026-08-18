"use client";

import { ExternalLink } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { buildDeepLinks, type WalletPlatform } from "@/lib/solana";

/**
 * Mobile wallet connection (design spec A11, F12).
 *
 * On iOS a wallet cannot inject into Safari or Chrome, so "Connect wallet" has
 * nothing to connect to. The route that works is a universal link that reopens
 * this page inside the wallet's own browser, where injection does work.
 *
 * The design rule from §A11 is that the deep link is offered EXPLICITLY rather
 * than attempted invisibly. A silent redirect out of the browser, on a page
 * about moving money, is indistinguishable from a hijack — so the user presses
 * a button that says where it goes.
 *
 * Targets are 56px: comfortably past the 44px minimum, and this is the control
 * a first-time mobile user meets before anything else works.
 */
export function MobileWalletConnect({ platform }: { platform: WalletPlatform }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (platform === "unsupported-webview") {
    return (
      <Alert
        level="warn"
        title="This browser cannot connect a wallet"
        funds="Nothing has been sent and no funds are at risk — connecting is simply unavailable here."
        next="Open this page in Chrome or Safari, or in your wallet app's own browser, then connect from there."
      >
        <p>
          You are viewing this inside an app&apos;s built-in browser, which Solana wallets
          cannot reach.
        </p>
      </Alert>
    );
  }

  if (platform === "android") {
    return (
      <Alert level="info" title="Connect with your wallet app">
        <p>
          Choose a wallet above. Your phone will switch to the wallet app to approve the
          connection, then bring you back here.
        </p>
      </Alert>
    );
  }

  // The path is ours; the origin comes from configuration inside
  // `buildDeepLinks`. See the note in src/lib/solana/deep-links.ts.
  const query = searchParams.toString();
  const links = buildDeepLinks(`${pathname}${query ? `?${query}` : ""}`);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-heading-3 text-ink-950">Open in your wallet app</p>
        <p className="text-body-sm text-ink-600">
          Wallets cannot connect to this browser on iPhone. Opening this page in your
          wallet app connects it and brings you straight back to where you were.
        </p>
      </div>

      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.id}>
            <a
              href={link.url}
              // Not `_blank`: this is a handoff to an app, and a stranded empty
              // tab behind it is the most common way people lose their place.
              className="border-ink-300 text-body-lg text-ink-950 hover:bg-ink-50 flex h-14 items-center justify-between gap-3 rounded-md border px-4 font-medium"
            >
              <span>Open in {link.name}</span>
              <ExternalLink aria-hidden="true" className="size-5 shrink-0" />
            </a>
          </li>
        ))}
      </ul>

      <p className="text-body-sm text-ink-500">
        Do not have either app? Install one, then come back to this page and try again.
      </p>
    </div>
  );
}

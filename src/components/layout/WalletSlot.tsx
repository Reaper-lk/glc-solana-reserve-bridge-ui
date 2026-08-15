"use client";

import dynamic from "next/dynamic";

/**
 * `@solana/wallet-adapter-*` and `@solana/web3.js` are the single largest
 * dependency this app carries, and every page renders the header wallet
 * control whether or not the visitor ever touches it. Loading `WalletButton`
 * as its own async chunk — rather than importing it at module scope, which
 * would bundle the wallet libraries into the same chunk as everything else
 * in the initial page load — keeps that weight out of first paint.
 *
 * `ssr: false` requires a Client Component boundary, which is the only
 * reason this file exists separately from `AppShell` (a Server Component).
 * The loading fallback matches `WalletButton`'s own pre-hydration
 * placeholder exactly, so there is nothing for a user to notice.
 */
const WalletButton = dynamic(
  () => import("@/features/wallet/WalletButton").then((mod) => mod.WalletButton),
  { ssr: false, loading: () => <div className="h-10 w-36" aria-hidden="true" /> },
);

export function WalletSlot() {
  return <WalletButton />;
}

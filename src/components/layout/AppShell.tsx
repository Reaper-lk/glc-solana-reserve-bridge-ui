import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BridgeStatusBar } from "./BridgeStatusBar";
import { ReserveBanner } from "./ReserveBanner";
import { WalletSlot } from "./WalletSlot";
import { isMockMode } from "@/lib/api";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * Application shell (design spec 6 / G1).
 *
 * Header, global trust strip, page outlet, footer. The skip link is first in
 * the DOM so keyboard users are not forced through the whole navigation on
 * every page.
 */
export function AppShell({
  children,
  initialStatus,
}: {
  children: ReactNode;
  initialStatus?: BridgeStatusDto;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <a
        href="#main"
        className="focus:bg-ink-950 focus:text-body sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <Header walletSlot={<WalletSlot />} />

      {/*
        Grouped in its own landmark, separate from Header's own top-level
        banner landmark, so this notice content is reachable via landmark
        navigation rather than floating outside every region.
      */}
      <div role="region" aria-label="Bridge notices">
        {isMockMode && (
          <p className="bg-ink-950 text-body-sm px-4 py-1.5 text-center text-white">
            Development build — all figures on this site come from local fixtures and
            describe nothing real.
          </p>
        )}

        <BridgeStatusBar {...(initialStatus ? { initialStatus } : {})} />
        {/*
          Site-wide and above the fold on every page. Under-collateralisation is
          the one condition that must reach a reader wherever they are, so it is
          not confined to the Proof of Reserves page (design spec G10).
        */}
        <ReserveBanner />
      </div>

      <main id="main" className="flex-1">
        {children}
      </main>

      <Footer />
    </div>
  );
}

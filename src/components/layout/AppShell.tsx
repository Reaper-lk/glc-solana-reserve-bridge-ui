import type { ReactNode } from "react";
import { FlaskConical, ServerCog } from "lucide-react";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BridgeStatusBar } from "./BridgeStatusBar";
import { ReserveBanner } from "./ReserveBanner";
import { WalletSlot } from "./WalletSlot";
import { isMockMode } from "@/lib/api";
import { devBuildSha } from "@/lib/dev/build-info";
import { env } from "@/lib/config/env";
import { toneStyles } from "@/lib/status";
import { cn } from "@/lib/utils/cn";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * Distinguishes real-but-non-production backend traffic (a local
 * regtest/test-validator instance, a shared staging deployment) from
 * mainnet/production, so this build never presents test data as if it were
 * real. `NODE_ENV` alone is the right signal here: `bridgeApiMode === "http"`
 * is also true in production, but a production *build* is the one case this
 * banner must never appear in.
 */
const isNonProductionBuild = process.env.NODE_ENV !== "production";

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
          <div className={cn("border-b", toneStyles.neutral.bar)}>
            <p className="text-body-sm text-ink-700 mx-auto flex max-w-page items-center justify-center gap-2 px-4 py-1.5 text-center md:px-6">
              <FlaskConical aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
              <span>
                <span className="font-medium">Mock data mode</span>
                {devBuildSha ? ` (build ${devBuildSha})` : ""} — every figure on this site
                comes from local fixtures and describes nothing real.
              </span>
            </p>
          </div>
        )}
        {!isMockMode && isNonProductionBuild && (
          <div className={cn("border-b", toneStyles.warn.bar)}>
            <p className="text-body-sm text-warn-700 mx-auto flex max-w-page items-center justify-center gap-2 px-4 py-1.5 text-center md:px-6">
              <ServerCog aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
              <span>
                <span className="font-medium">Real local backend / test network mode</span>
                {devBuildSha ? ` (build ${devBuildSha})` : ""} — connected to{" "}
                <span className="font-mono">{env.bridgeApiUrl}</span>, a real bridge
                instance on test infrastructure, not mainnet. Figures here are genuine but
                describe no real money.
              </span>
            </p>
          </div>
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

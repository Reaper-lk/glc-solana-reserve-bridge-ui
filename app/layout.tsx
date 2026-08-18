import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";

import { AppShell } from "@/components/layout/AppShell";
import { QueryProvider } from "@/lib/query/provider";
import { SolanaProvider } from "@/lib/solana";
import { bridgeApi } from "@/lib/api";
import { env } from "@/lib/config/env";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: "Goldcoin Reserve Bridge",
    template: "%s · Goldcoin Reserve Bridge",
  },
  description:
    "Move existing GLC between the Goldcoin blockchain and Solana through a reserve-backed bridge. No minting, no wrapping — every transfer is publicly verifiable.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is never disabled: pinch-zoom is an accessibility requirement, and on
  // this product it is how people read an address before sending funds.
  maximumScale: 5,
};

/**
 * Fetch the status snapshot on the server so the global trust strip is
 * correct on first paint. A failure here degrades to a client fetch rather
 * than taking the whole page down.
 */
async function loadInitialStatus(): Promise<BridgeStatusDto | undefined> {
  try {
    return await bridgeApi.getStatus();
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
   * Reading a request header opts this tree into per-request rendering,
   * which is what lets Next stamp the CSP nonce onto its own script tags —
   * see middleware.ts.
   */
  await headers();

  const initialStatus = await loadInitialStatus();

  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <QueryProvider>
          <SolanaProvider>
            <AppShell {...(initialStatus ? { initialStatus } : {})}>{children}</AppShell>
          </SolanaProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

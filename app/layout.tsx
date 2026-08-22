import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { plexMono, plexSans } from "./fonts";
import "./globals.css";

import { AppShell } from "@/components/layout/AppShell";
import { QueryProvider } from "@/lib/query/provider";
import { SolanaProvider } from "@/lib/solana";
import { loadInitialStatus } from "@/lib/api/initial-status";
import { env } from "@/lib/config/env";

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

/*
 * The status snapshot is fetched server-side so the global trust strip is
 * correct on first paint — with an SSR-only 1.5s fail-fast budget
 * (src/lib/api/initial-status.ts) so an offline backend degrades the page
 * quickly instead of blocking every route for the client's full timeout.
 */

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

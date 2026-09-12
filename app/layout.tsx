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
import { siteIdentity } from "@/lib/config/site-identity";
import { buildPrePaintScript } from "@/lib/theme/pre-paint-script";

/*
 * Identity, not decoration.
 *
 * A Wallet Standard dApp hands the wallet no metadata object: Phantom and the
 * domain reputation services behind it read the page. Declaring the canonical
 * origin, the site name and the icon is how this deployment states which app
 * it is; omitting them leaves a bridge that asks for signatures looking, to an
 * automated reviewer, exactly like an unidentified clone of one. Every value
 * comes from `NEXT_PUBLIC_APP_URL` via `siteIdentity`, so it is the operator's
 * configured origin or nothing — never a hardcoded or guessed domain.
 */
export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  applicationName: siteIdentity.name,
  title: {
    default: siteIdentity.name,
    template: `%s · ${siteIdentity.name}`,
  },
  description: siteIdentity.description,
  robots: { index: true, follow: true },
  // Relative, and therefore resolved against `metadataBase`: the canonical
  // URL must name the configured origin and can never name whichever host
  // happened to serve the response.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteIdentity.name,
    title: siteIdentity.name,
    description: siteIdentity.description,
    url: "/",
    images: [
      { url: siteIdentity.iconPath, width: 512, height: 512, alt: siteIdentity.name },
    ],
  },
  twitter: {
    card: "summary",
    title: siteIdentity.name,
    description: siteIdentity.description,
    images: [siteIdentity.iconPath],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches `--color-surface`, so the browser chrome agrees with the page
  // rather than flashing a default white bar over a dark ground.
  themeColor: siteIdentity.themeColor,
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

/*
 * Built once at module scope: it is a constant string, and rebuilding it per
 * request would be work on the critical path of every page.
 */
const prePaintScript = buildPrePaintScript();

export default async function RootLayout({ children }: { children: ReactNode }) {
  /*
   * Reading a request header opts this tree into per-request rendering,
   * which is what lets Next stamp the CSP nonce onto its own script tags —
   * see middleware.ts.
   */
  const requestHeaders = await headers();

  /*
   * The same nonce middleware put in the policy. Without it the pre-paint
   * theme script below is blocked outright by `script-src` and every visitor
   * with a dark preference gets a white flash — so this is read from the
   * request rather than assumed.
   */
  const nonce = requestHeaders.get("x-nonce");

  const initialStatus = await loadInitialStatus();

  return (
    /*
     * `suppressHydrationWarning` is required and is scoped to this element
     * alone: the pre-paint script rewrites <html>'s class, `data-theme` and
     * `color-scheme` before React ever sees the document, and without this
     * React would treat its own (themeless) output as the truth, discard the
     * DOM and re-render the tree — which is both the flash we are preventing
     * and a wasted client render.
     */
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Synchronous, first thing in <head>, and inline on purpose. An
          external file would be a second round trip before first paint, and
          `useLayoutEffect` runs only after hydration — by which point a slow
          connection has already painted the wrong theme. See src/lib/theme.
        */}
        <script
          {...(nonce ? { nonce } : {})}
          dangerouslySetInnerHTML={{ __html: prePaintScript }}
        />
      </head>
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

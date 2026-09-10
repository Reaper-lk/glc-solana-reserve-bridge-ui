"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AddressCompact } from "@/components/ui/AddressChunks";
import { isUserRejection, needsDeepLink, useWalletConnection } from "@/lib/solana";
import { routes, solanaAddressUrl } from "@/lib/config/links";
import { MobileWalletConnect } from "./MobileWalletConnect";

/**
 * The Solana wallet control, for a Solana source.
 *
 * The counterpart of `RobinhoodWalletConnect`, and deliberately the same
 * shape: a row of connect buttons in the FROM panel, one per wallet this
 * browser actually has. A wallet is needed for exactly the network that is
 * selected, so it is asked for there rather than site-wide.
 *
 * Only DETECTED wallets get a button. A button labelled "Connect Phantom"
 * that cannot connect to Phantom is worse than a sentence saying nothing
 * was found — the install path stays discoverable through the Wallets
 * page, which is written for it.
 *
 * On iOS nothing can inject, so the deep-link flow replaces the list
 * outright rather than sitting under it as a fallback (design spec A11).
 * That is the same component the wallet dialog uses; this control is a
 * different presentation of the same connection, not a second one.
 */
export function SolanaWalletConnect() {
  const { status, address, wallets, error, platform, connect, disconnect } =
    useWalletConnection();

  // The server cannot know which wallets exist. Rendering a list before
  // hydration would assert a state that may turn out to be wrong, on a
  // page about moving money.
  if (status === "initialising") {
    return <div className="h-8" aria-hidden="true" />;
  }

  if (status === "unconfigured") {
    return (
      <p className="text-body-sm text-ink-500">
        Solana wallet connection is not configured for this deployment.
      </p>
    );
  }

  if (status === "connected" && address) {
    // Null when no explorer template is configured, in which case the
    // address renders as plain text rather than as a link to a guessed host.
    const explorerUrl = solanaAddressUrl(address);

    return (
      <div className="text-body-sm text-ink-600 flex flex-wrap items-center gap-2">
        <Check aria-hidden="true" className="text-success-500 size-4 shrink-0" />
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
          >
            <AddressCompact address={address} lead={4} tail={4} />
          </a>
        ) : (
          <AddressCompact address={address} lead={4} tail={4} />
        )}
        <button
          type="button"
          onClick={() => void disconnect()}
          className="text-ink-500 hover:text-ink-900 underline underline-offset-2"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (needsDeepLink(platform) || platform === "unsupported-webview") {
    return <MobileWalletConnect platform={platform} />;
  }

  const detected = wallets.filter((wallet) => wallet.installed);

  if (detected.length === 0) {
    return (
      <p className="text-body-sm text-ink-500">
        No Solana wallet was detected. Install one, then reload this page —{" "}
        <Link
          href={routes.wallets}
          className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
        >
          the wallets we support
        </Link>
        .
      </p>
    );
  }

  // Dismissing a wallet popup is a decision, not a fault, so it never
  // surfaces as an error state.
  const showError = error && !isUserRejection(error);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {detected.map((wallet) => (
          <Button
            key={wallet.id}
            variant="secondary"
            size="sm"
            loading={status === "connecting"}
            onClick={() => void connect(wallet.id)}
          >
            {/* The icon is a wallet-supplied data URI. Rendered as an
                image only — never injected as markup. */}
            {wallet.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URI from the wallet, not a served asset
              <img src={wallet.iconUrl} alt="" aria-hidden="true" className="size-4" />
            ) : null}
            Connect {wallet.name}
          </Button>
        ))}
      </div>
      {showError && (
        <p className="text-body-sm text-danger-700">
          {error.what} {error.next}
        </p>
      )}
    </div>
  );
}

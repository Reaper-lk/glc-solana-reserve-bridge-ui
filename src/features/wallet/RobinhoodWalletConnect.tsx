"use client";

import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AddressCompact } from "@/components/ui/AddressChunks";
import type { EvmWalletState } from "@/lib/evm";
import { robinhoodAddressUrl } from "@/lib/config/links";

/**
 * The Robinhood Network (EVM) wallet control.
 *
 * Deliberately in the bridge form rather than the header, as every source
 * network's control now is: a Robinhood wallet is needed for exactly one
 * route and only while that route is selected, so prompting for it
 * site-wide would ask most users to connect a wallet they will never use.
 * `SolanaWalletConnect` is the same control for a Solana source.
 *
 * Injected wallets only (EIP-6963, with a legacy `window.ethereum`
 * fallback). Nothing here connects on mount: `eth_accounts` restores an
 * already-authorised account silently, and a wallet dialog opens only when
 * someone presses a button.
 *
 * Every unusable state names its own cause instead of collapsing into one
 * disabled control — no wallet installed and a wallet on the wrong
 * network are different problems with different answers.
 *
 * What this control deliberately does NOT speak for is the contract. It
 * reads `wallet.network` — the pinned chain identity, which always
 * resolves — never the deposit deployment. Whether a deposit can be built
 * (contract configuration, route availability, the rolling-24h windows)
 * is stated at the deposit action, where it applies. Connecting a wallet
 * moves nothing, and refusing to offer it because a route is paused or an
 * optional variable is unset tells a user their wallet is unsupported
 * when it is not.
 */
export function RobinhoodWalletConnect({ wallet }: { wallet: EvmWalletState }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The wallet request failed.");
    } finally {
      setBusy(false);
    }
  };

  // There is deliberately no "this network is not configured" branch.
  //
  // `wallet.network` is the pinned chain id, its name and an RPC URL with
  // a production default — it always resolves, because connecting a
  // wallet touches no contract. This control used to gate on
  // `wallet.deployment`, which additionally required a bridge address, a
  // token address and an RPC URL from the environment; a deployment that
  // had not set the optional ones therefore refused to offer a connect
  // button at all, on a chain whose identity is a compile-time constant.
  //
  // A deployment whose CONTRACT configuration is refused still connects a
  // wallet, and so does a paused or unavailable route. Both of those are
  // stated where they apply — at the deposit action — rather than here,
  // because neither is a reason a wallet cannot be connected.
  if (!wallet.hasInjectedWallet) {
    return (
      <p className="text-body-sm text-ink-500">
        No browser wallet was detected. Install an EVM wallet extension to deposit from{" "}
        {wallet.network.chainName}.
      </p>
    );
  }

  if (!wallet.address) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {wallet.wallets.map((injected) => (
            <Button
              key={injected.uuid}
              variant="secondary"
              size="sm"
              loading={wallet.connecting || busy}
              onClick={() => void run(() => wallet.connect(injected.uuid))}
            >
              {/* The icon is a wallet-supplied data URI. Rendered as an
                  image only — never injected as markup. */}
              {injected.icon ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URI from the wallet, not a served asset
                <img src={injected.icon} alt="" aria-hidden="true" className="size-4" />
              ) : null}
              Connect {injected.name}
            </Button>
          ))}
        </div>
        {error && <p className="text-body-sm text-danger-700">{error}</p>}
      </div>
    );
  }

  // Null when no explorer template is configured, in which case the
  // address renders as plain text rather than as a link to a guessed host.
  const explorerUrl = robinhoodAddressUrl(wallet.address);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-body-sm text-ink-600 flex flex-wrap items-center gap-2">
        {wallet.onExpectedChain ? (
          <Check aria-hidden="true" className="text-success-500 size-4 shrink-0" />
        ) : (
          <AlertTriangle aria-hidden="true" className="text-warn-500 size-4 shrink-0" />
        )}
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
          >
            <AddressCompact address={wallet.address} lead={6} tail={4} />
          </a>
        ) : (
          <AddressCompact address={wallet.address} lead={6} tail={4} />
        )}
        <button
          type="button"
          onClick={wallet.disconnect}
          className="text-ink-500 hover:text-ink-900 underline underline-offset-2"
        >
          Forget
        </button>
      </div>

      {!wallet.onExpectedChain && (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-ink-600">
            This wallet is on a different network. Switch it to {wallet.network.chainName}{" "}
            before depositing.
          </p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => void run(wallet.switchChain)}
            >
              Switch to {wallet.network.chainName}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-body-sm text-danger-700">{error}</p>}
    </div>
  );
}

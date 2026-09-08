"use client";

import { Wallet } from "lucide-react";
import type { ChainAdapter } from "@/lib/bridge";
import type { EvmWalletState } from "@/lib/evm";
import { RobinhoodWalletConnect } from "@/features/wallet/RobinhoodWalletConnect";
import { ExchangeAddressWarning } from "./ExchangeAddressWarning";

/**
 * The per-network controls that hang off the two panels.
 *
 * # The one place chain-specific rendering lives
 *
 * `BridgeForm` renders `<SourceContext chain=… />` and
 * `<DestinationContext chain=… />` and knows nothing else about any
 * network. Every "if this is Robinhood" in the UI is in this file, keyed
 * by chain id, so adding a network means adding a case here rather than
 * threading a new condition through the form's amount handling, its gate,
 * its submit path and its copy.
 *
 * Behavioural rules — address formats, funding kinds — are not here
 * either; those live in the `ChainAdapter` table. This file is only the
 * JSX that a table cannot hold.
 */

/**
 * Source-side controls. Only a wallet-funded source has any: a Goldcoin
 * source is funded by sending to an address the backend issues AFTER the
 * request is created, so there is nothing to connect beforehand.
 */
export function SourceContext({
  chainId,
  evmWallet,
}: {
  chainId: string;
  evmWallet: EvmWalletState;
}) {
  if (chainId === "robinhood") {
    return <RobinhoodWalletConnect wallet={evmWallet} />;
  }
  // Solana's wallet is connected once for the whole site from the header,
  // and the submit gate states plainly when it is not — a second connect
  // control here would be a duplicate of it. Goldcoin has no source
  // wallet to connect at all.
  return null;
}

/**
 * Destination-side controls: the recipient address, named and validated as
 * the destination network's own address type.
 *
 * The field itself is shared across networks — only its label,
 * placeholder and validator differ, and all three come from the adapter.
 * That is what stops a Solana address from being checked against
 * Goldcoin's rules when a route changes.
 */
export function DestinationContext({
  adapter,
  value,
  onChange,
  message,
  connectedSolanaAddress,
}: {
  adapter: ChainAdapter;
  value: string;
  onChange: (value: string) => void;
  /** The validator's message, or null while the field is merely empty. */
  message: string | null;
  /** The connected Solana wallet, for the fill-in shortcut. */
  connectedSolanaAddress: string | null;
}) {
  const showShortcut =
    adapter.offersConnectedWalletShortcut &&
    connectedSolanaAddress !== null &&
    value.trim() === "";

  return (
    <div>
      <label
        htmlFor="bridge-recipient"
        className="text-body-sm text-ink-600 mb-0.5 block"
      >
        {adapter.addressLabel}
      </label>
      {/* One height at every width, 42px. The desktop row used to tighten
          to 30px, which was smaller than anything else in the panel and
          read as an afterthought next to a 50px amount row; 42px also
          clears the 16px the base layer forces on inputs below `md` so
          iOS does not zoom, with room for a thumb. */}
      <div className="border-ink-200 bg-surface-raised focus-within:border-ink-400 flex items-center gap-2 rounded-lg border px-3 py-3 transition-colors">
        <Wallet aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
        <input
          id="bridge-recipient"
          aria-label={adapter.addressLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={adapter.addressPlaceholder}
          className="text-mono-sm min-w-0 flex-1 bg-transparent outline-none"
        />
      </div>

      {showShortcut && (
        <button
          type="button"
          onClick={() => onChange(connectedSolanaAddress)}
          // Stepped up one from the panel's own `ink-50`, for the same
          // reason MAX was: a chip the colour of its ground is invisible.
          className="bg-ink-100 text-ink-700 hover:bg-ink-200 text-body-sm mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors"
        >
          Use connected wallet ({connectedSolanaAddress.slice(0, 4)}…
          {connectedSolanaAddress.slice(-4)})
        </button>
      )}

      {value.trim() !== "" && message && (
        <p className="text-body-sm text-danger-700 mt-1">{message}</p>
      )}

      {/* Paying out on Goldcoin carries a risk no address validator can
          catch: an exchange deposit address that does not credit bridge
          payouts. Shown for every route that ends on Goldcoin, not just
          the one it was originally written for. */}
      {adapter.chain.id === "goldcoin" && (
        <div className="mt-2">
          <ExchangeAddressWarning />
        </div>
      )}
    </div>
  );
}

import { AddressChunks, CopyButton } from "@/components/ui";
import { GOLDCOIN_GLC } from "@/lib/bridge/direction";
import { formatBaseUnits } from "@/lib/format/amount";
import { CollapsibleQR } from "./CollapsibleQR";

/**
 * Deposit instructions for the Goldcoin -> Solana direction, exactly as
 * `POST /transfers` returned them: a deposit address unique to this one
 * request (`goldcoin::derivation` in glc-solana-reserve-bridge). The user
 * sends the exact amount they requested to it directly — no OP_RETURN, no
 * memo, no salted amount, no special wallet functionality.
 */
export function DepositInstructions({
  depositAddress,
  amountAtomic,
}: {
  depositAddress: string;
  /** Integer base-unit (8-decimal) GLC string — the exact amount to send. */
  amountAtomic: string;
}) {
  const amountDisplay = formatBaseUnits(amountAtomic, GOLDCOIN_GLC.decimals);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body-sm text-ink-600 mb-1">Send exactly</p>
        <p className="text-heading-3">
          {amountDisplay} {GOLDCOIN_GLC.symbol}
        </p>
      </div>

      <CollapsibleQR value={depositAddress} label="deposit address" />

      <div>
        <p className="text-body-sm text-ink-600 mb-1">Send to</p>
        <div className="border-ink-200 flex items-center justify-between gap-2 rounded-lg border p-3">
          <AddressChunks address={depositAddress} size="sm" />
          <CopyButton value={depositAddress} label="deposit address" />
        </div>
      </div>
    </div>
  );
}

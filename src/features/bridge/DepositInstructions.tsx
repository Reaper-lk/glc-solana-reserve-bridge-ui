import { AddressChunks, Alert, CopyButton } from "@/components/ui";
import { CollapsibleQR } from "./CollapsibleQR";

/**
 * Deposit instructions for the Goldcoin -> Solana direction, exactly as
 * `POST /transfers` returned them. The OP_RETURN requirement is not
 * optional decoration — without it the deposit cannot be bound to this
 * request id (`goldcoin/deposit.rs` in glc-solana-reserve-bridge), so it is
 * stated as plainly as the address itself.
 */
export function DepositInstructions({
  depositVaultAddress,
  depositBindingHex,
}: {
  depositVaultAddress: string;
  depositBindingHex: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <CollapsibleQR value={depositVaultAddress} label="deposit address" />

      <div>
        <p className="text-body-sm text-ink-600 mb-1">Send to</p>
        <div className="border-ink-200 flex items-center justify-between gap-2 rounded-lg border p-3">
          <AddressChunks address={depositVaultAddress} size="sm" />
          <CopyButton value={depositVaultAddress} label="deposit address" />
        </div>
      </div>

      <Alert
        level="warn"
        title="This deposit requires an OP_RETURN output"
        funds="No funds have moved yet. Nothing is at risk until you broadcast a transaction."
        next="Your Goldcoin transaction must include an OP_RETURN output carrying the binding value below, in addition to the payment. A wallet that cannot add a custom OP_RETURN output cannot complete this deposit."
      >
        <div className="border-ink-200 mt-2 flex items-center justify-between gap-2 rounded-lg border p-3">
          <span className="text-mono-sm break-all">{depositBindingHex}</span>
          <CopyButton value={depositBindingHex} label="OP_RETURN binding value" />
        </div>
      </Alert>
    </div>
  );
}

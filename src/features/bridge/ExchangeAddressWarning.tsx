import { Alert } from "@/components/ui/Alert";

/**
 * ExchangeAddressWarning (design spec A8).
 *
 * Format and checksum validation cannot catch the two losses that actually
 * happen: sending to an exchange deposit address that does not credit bridge
 * payouts, and sending to an address the user does not control.
 *
 * Non-blocking by design. We cannot tell an exchange address from a personal
 * one, so blocking would refuse legitimate transfers on a guess. It is shown
 * every time instead, at full visibility, because the cost of reading it is a
 * few seconds and the cost of not reading it is the whole transfer.
 */
export function ExchangeAddressWarning() {
  return (
    <Alert
      level="warn"
      title="Sending to an exchange?"
      funds="Many exchanges do not credit bridge payouts. Funds sent to an address that does not accept them cannot be recovered by the bridge or by us."
      next="Use a Goldcoin wallet you control. If you do want the coins on an exchange, move them there yourself once the payout arrives."
    />
  );
}

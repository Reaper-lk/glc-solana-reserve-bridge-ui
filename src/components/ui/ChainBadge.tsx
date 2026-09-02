import type { Chain } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

/**
 * ChainBadge (design spec E2 "chain accent colors", G3).
 *
 * Chain colour is IDENTITY, never state. Goldcoin's accent is the brand gold
 * and Solana's is violet; neither means "healthy" or "failed", and neither is
 * ever used to convey status. That separation is the reason status tones carry
 * no gold anywhere in the system.
 *
 * The badge is a diamond mark plus the chain's name. The mark alone would be a
 * bare coloured glyph, which acceptance criterion 1 forbids.
 */

const chainStyles: Record<Chain, { readonly mark: string; readonly label: string }> = {
  goldcoin: { mark: "text-chain-goldcoin", label: "Goldcoin" },
  solana: { mark: "text-chain-solana", label: "Solana" },
  // Robinhood has no brand accent token of its own yet; it reuses the
  // neutral ink scale deliberately rather than borrowing another chain's
  // colour, which would read as that chain. Chain colour is identity, never
  // state (see above), so a neutral identity is the honest placeholder.
  robinhood: { mark: "text-ink-500", label: "Robinhood Network" },
};

export function ChainBadge({ chain, className }: { chain: Chain; className?: string }) {
  const style = chainStyles[chain];

  return (
    <span
      className={cn(
        "text-label text-ink-700 inline-flex items-center gap-1.5 font-medium",
        className,
      )}
    >
      <span aria-hidden="true" className={style.mark}>
        ◆
      </span>
      {style.label}
    </span>
  );
}

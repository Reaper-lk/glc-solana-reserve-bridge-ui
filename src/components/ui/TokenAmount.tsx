import { formatBaseUnits, type FormatOptions } from "@/lib/format/amount";
import { cn } from "@/lib/utils/cn";

/**
 * TokenAmount (design spec E3, acceptance criterion 4).
 *
 * Tabular figures are applied unconditionally so a value that ticks does not
 * jitter, and the symbol is never omitted. The component takes base units and
 * decimals rather than a formatted string, so formatting cannot diverge between
 * call sites.
 */
export function TokenAmount({
  raw,
  decimals,
  symbol,
  className,
  symbolClassName,
  options,
}: {
  raw: string;
  decimals: number;
  symbol: string;
  className?: string;
  symbolClassName?: string;
  options?: FormatOptions;
}) {
  let formatted: string;
  try {
    formatted = formatBaseUnits(raw, decimals, options);
  } catch {
    // A malformed amount renders as unavailable. It never renders as zero:
    // a zero balance and an unknown balance mean very different things.
    return <span className={cn("text-ink-500", className)}>— {symbol}</span>;
  }

  return (
    <span className={cn("tabular", className)}>
      {formatted} <span className={cn("text-ink-500", symbolClassName)}>{symbol}</span>
    </span>
  );
}

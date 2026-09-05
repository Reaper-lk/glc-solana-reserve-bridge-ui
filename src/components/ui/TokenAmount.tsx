import {
  DISPLAY_FORMAT_OPTIONS,
  formatBaseUnits,
  type FormatOptions,
} from "@/lib/format/amount";
import { cn } from "@/lib/utils/cn";

/**
 * How much precision this amount is rendered at.
 *
 * `display` — the default — is two decimal places, which is what a summary,
 * stat or value surface wants: the reader is after the magnitude, and eight
 * decimals of a settled volume are noise they have to read past.
 *
 * `exact` shows every digit the token has, and is for the figures a person
 * acts on literally: a balance they are about to spend, an amount they must
 * send to the base unit. Rounding those, even by one unit at the display
 * layer, would state something the chain does not agree with.
 *
 * Either way the `raw` base units are untouched — this is presentation only.
 */
export type AmountPrecision = "display" | "exact";

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
  precision = "display",
  options,
}: {
  raw: string;
  decimals: number;
  symbol: string;
  className?: string;
  symbolClassName?: string;
  precision?: AmountPrecision;
  options?: FormatOptions;
}) {
  // An explicit `options` still wins, so a call site that needs its own
  // precision — SOL at four places — says so without a second code path.
  const resolved: FormatOptions =
    precision === "display" ? { ...DISPLAY_FORMAT_OPTIONS, ...options } : (options ?? {});

  let formatted: string;
  try {
    formatted = formatBaseUnits(raw, decimals, resolved);
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

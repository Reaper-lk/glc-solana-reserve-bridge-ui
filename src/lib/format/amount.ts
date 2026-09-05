/**
 * Amount formatting.
 *
 * Token amounts move through this application as integer strings of base units
 * (the smallest indivisible unit of the token), never as JavaScript numbers.
 * `0.1 + 0.2` is a defect in a bridge UI, and a float cannot hold a large GLC
 * balance without silently losing precision. Conversion to a human-readable
 * decimal happens exactly once, here, using integer arithmetic.
 *
 * Two precisions exist, and the distinction is deliberate:
 *
 * - EXACT, the default, shows every digit the token has. It is for figures a
 *   person acts on literally — the amount to send to a deposit address, the
 *   published minimum and maximum, a wallet balance they are about to spend.
 * - DISPLAY, `DISPLAY_FORMAT_OPTIONS`, shows exactly two decimal places. It is
 *   for summary, stat and value surfaces, where `96,218,058.29927559 GLC` is
 *   noise that costs a reader the magnitude they came for.
 *
 * Both read the same exact base units. Neither ever mutates a stored value.
 */

export class AmountFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountFormatError";
  }
}

const BASE_UNITS_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * How a value that does not fit the requested precision is reduced.
 *
 * `truncate` never overstates a figure by so much as one base unit, which is
 * why it is the default for exact surfaces. `nearest` rounds half away from
 * zero, which is what a reader expects of a two-decimal summary: a settled
 * volume of `…29927559` reads as `…30`, not `…29`.
 */
export type RoundingMode = "truncate" | "nearest";

export interface FormatOptions {
  /** Digits always shown after the point. Default 2, matching the design docs. */
  readonly minFractionDigits?: number;
  /** Upper bound on fraction digits. Defaults to the token's decimals. */
  readonly maxFractionDigits?: number;
  /** Thousands grouping. Default true. */
  readonly grouping?: boolean;
  /** How excess precision is dropped. Default `truncate`. */
  readonly rounding?: RoundingMode;
}

/** Fraction digits shown on summary, stat and value surfaces. */
export const DISPLAY_FRACTION_DIGITS = 2;

/**
 * The single display precision for user-facing GLC surfaces: exactly two
 * decimal places, rounded to nearest, thousands separators kept.
 *
 * Every summary/stat/value surface goes through this — via `TokenAmount`,
 * `formatDisplayAmount` or `formatDisplayDecimal` — rather than calling
 * `toFixed` at the call site, so the precision is one decision in one place.
 */
export const DISPLAY_FORMAT_OPTIONS: FormatOptions = Object.freeze({
  minFractionDigits: DISPLAY_FRACTION_DIGITS,
  maxFractionDigits: DISPLAY_FRACTION_DIGITS,
  rounding: "nearest",
  grouping: true,
});

/**
 * Render an integer base-unit string as a decimal string.
 *
 * The arithmetic is exact: digits are reduced with BigInt division, so a value
 * far beyond `Number.MAX_SAFE_INTEGER` formats without losing a digit. The
 * input string is never modified.
 */
export function formatBaseUnits(
  raw: string,
  decimals: number,
  options: FormatOptions = {},
): string {
  if (!BASE_UNITS_PATTERN.test(raw)) {
    throw new AmountFormatError(
      `Expected an integer base-unit string, received "${raw}"`,
    );
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new AmountFormatError(`Unsupported decimals value: ${decimals}`);
  }

  const {
    minFractionDigits = Math.min(DISPLAY_FRACTION_DIGITS, decimals),
    maxFractionDigits = decimals,
    grouping = true,
    rounding = "truncate",
  } = options;

  if (minFractionDigits > maxFractionDigits) {
    throw new AmountFormatError("minFractionDigits cannot exceed maxFractionDigits");
  }

  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;

  // Digits kept after the point, and digits the requested precision drops.
  const kept = Math.min(maxFractionDigits, decimals);
  const dropped = decimals - kept;

  let scaled = BigInt(digits);
  if (dropped > 0) {
    const divisor = 10n ** BigInt(dropped);
    const remainder = scaled % divisor;
    scaled /= divisor;
    // Half away from zero, on the magnitude — the sign is carried separately.
    if (rounding === "nearest" && remainder * 2n >= divisor) scaled += 1n;
  }

  const padded = scaled.toString().padStart(kept + 1, "0");
  const wholePart = kept === 0 ? padded : padded.slice(0, padded.length - kept);
  const fractionPart = kept === 0 ? "" : padded.slice(padded.length - kept);

  const trimmed = fractionPart.replace(/0+$/, "");
  const fraction = trimmed.padEnd(minFractionDigits, "0");

  const whole = grouping ? groupDigits(wholePart) : wholePart;
  // A value that rounds to zero is zero: "-0.00" is not a balance.
  const sign = negative && scaled !== 0n ? "-" : "";

  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/**
 * Render base units at display precision: exactly two decimal places, grouped.
 *
 * Formatting only. The base units passed in are untouched, and every caller
 * keeps the exact value it was given for arithmetic and for the API.
 */
export function formatDisplayAmount(raw: string, decimals: number): string {
  return formatBaseUnits(raw, decimals, DISPLAY_FORMAT_OPTIONS);
}

/**
 * Render a fixed-point decimal string at display precision.
 *
 * For figures the backend already serves as a decimal rather than as base
 * units — `POST /quote` returns `gross_display_amount` and friends. The digits
 * are re-read as base units so the reduction is the same exact integer
 * arithmetic, never a float parse.
 */
export function formatDisplayDecimal(value: string): string {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) {
    throw new AmountFormatError(`Expected a decimal string, received "${value}"`);
  }
  const [whole = "", fraction = ""] = trimmed.split(".");
  return formatDisplayAmount(`${whole}${fraction}`, fraction.length);
}

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Parse a user-typed decimal string into base units.
 *
 * Returns null for anything not a well-formed non-negative decimal within the
 * token's precision. Callers treat null as "do not submit" — this function
 * never guesses at intent.
 */
export function parseToBaseUnits(input: string, decimals: number): string | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed.length === 0) return null;
  if (!/^\d*(\.\d*)?$/.test(trimmed)) return null;
  if (trimmed === ".") return null;

  const [wholeRaw = "", fractionRaw = ""] = trimmed.split(".");
  if (fractionRaw.length > decimals) return null;

  const whole = wholeRaw.length > 0 ? wholeRaw : "0";
  const fraction = fractionRaw.padEnd(decimals, "0");
  const combined = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");

  return combined.length > 0 ? combined : "0";
}

/** Compare two base-unit strings without converting to a number. */
export function compareBaseUnits(a: string, b: string): -1 | 0 | 1 {
  if (!BASE_UNITS_PATTERN.test(a) || !BASE_UNITS_PATTERN.test(b)) {
    throw new AmountFormatError("Both values must be integer base-unit strings");
  }
  const left = BigInt(a);
  const right = BigInt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Format a percentage from a ratio, e.g. the reserve backing figure. */
export function formatPercent(ratio: number, fractionDigits = 4): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(fractionDigits)}%`;
}

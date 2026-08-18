/**
 * Amount formatting.
 *
 * Token amounts move through this application as integer strings of base units
 * (the smallest indivisible unit of the token), never as JavaScript numbers.
 * `0.1 + 0.2` is a defect in a bridge UI, and a float cannot hold a large GLC
 * balance without silently losing precision. Conversion to a human-readable
 * decimal happens exactly once, here, using integer arithmetic.
 */

export class AmountFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountFormatError";
  }
}

const BASE_UNITS_PATTERN = /^-?\d+$/;

export interface FormatOptions {
  /** Digits always shown after the point. Default 2, matching the design docs. */
  readonly minFractionDigits?: number;
  /** Upper bound on fraction digits. Defaults to the token's decimals. */
  readonly maxFractionDigits?: number;
  /** Thousands grouping. Default true. */
  readonly grouping?: boolean;
}

/**
 * Render an integer base-unit string as a decimal string.
 *
 * Truncates rather than rounds: showing a user more of a balance than they
 * hold, even by one unit at the display layer, is the wrong direction to err.
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
    minFractionDigits = Math.min(2, decimals),
    maxFractionDigits = decimals,
    grouping = true,
  } = options;

  if (minFractionDigits > maxFractionDigits) {
    throw new AmountFormatError("minFractionDigits cannot exceed maxFractionDigits");
  }

  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).replace(/^0+(?=\d)/, "");
  const padded = digits.padStart(decimals + 1, "0");

  const wholePart = padded.slice(0, padded.length - decimals);
  const fractionPart = decimals === 0 ? "" : padded.slice(padded.length - decimals);

  const truncated = fractionPart.slice(0, Math.min(maxFractionDigits, decimals));
  const trimmed = truncated.replace(/0+$/, "");
  const fraction = trimmed.padEnd(minFractionDigits, "0");

  const whole = grouping ? groupDigits(wholePart) : wholePart;
  const sign = negative && /[1-9]/.test(padded) ? "-" : "";

  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
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

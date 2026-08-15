import { compareBaseUnits, formatBaseUnits, parseToBaseUnits } from "@/lib/format/amount";

/**
 * Amount entry (acceptance criterion 15).
 *
 * This is the single most safety-critical pure function in the bridge form. It
 * turns whatever a person typed into either an integer base-unit string or a
 * refusal with a reason — never a number, never a guess.
 *
 * Under the agreed credit-what-arrives model the amount field is a CALCULATOR,
 * not a commitment: it drives the quote preview, and the bridge mints whatever
 * actually arrives. Validation still matters, because a figure outside the
 * published limits produces a preview the bridge would not honour, and showing
 * someone a receive-amount for a deposit that will be rejected is worse than
 * showing nothing.
 *
 * Every bound is supplied by the caller from `GET /limits`. Nothing is
 * hardcoded here, and an absent bound means unbounded rather than a default
 * this module invented.
 */

export type AmountProblem =
  | "empty"
  | "malformed"
  | "too-many-decimals"
  | "zero"
  | "below-minimum"
  | "above-maximum";

export interface AmountBounds {
  /** Token precision. Digits beyond this cannot be represented on-chain. */
  readonly decimals: number;
  readonly symbol: string;
  /** Integer base-unit string, from the API. Absent means no lower bound. */
  readonly minimum?: string | undefined;
  /** Integer base-unit string, from the API. Absent means no upper bound. */
  readonly maximum?: string | undefined;
}

export interface AmountValidation {
  /** Integer base-unit string when the input is usable, otherwise null. */
  readonly raw: string | null;
  readonly problem: AmountProblem | null;
  /** User-facing explanation. Null exactly when there is no problem. */
  readonly message: string | null;
}

/**
 * Accepts only a plain non-negative decimal.
 *
 * `\d` is deliberately not unicode-aware: an Arabic-Indic or fullwidth digit
 * is rejected as malformed rather than silently reinterpreted. Scientific
 * notation, signs and hex are rejected for the same reason — a bridge amount
 * should be exactly what the user believes they typed.
 */
const DECIMAL_PATTERN = /^\d*(\.\d*)?$/;

const VALID: AmountValidation = { raw: null, problem: null, message: null };

function reject(problem: AmountProblem, message: string): AmountValidation {
  return { raw: null, problem, message };
}

export function validateAmount(input: string, bounds: AmountBounds): AmountValidation {
  const { decimals, symbol, minimum, maximum } = bounds;

  // Thousands separators are a display convention, so a pasted "1,000" is
  // read as one thousand rather than refused.
  const trimmed = input.trim().replace(/,/g, "");

  if (trimmed.length === 0) {
    return { ...VALID, problem: "empty" };
  }
  if (trimmed === "." || !DECIMAL_PATTERN.test(trimmed)) {
    return reject("malformed", `Enter an amount in ${symbol}, using digits only.`);
  }

  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    return reject(
      "too-many-decimals",
      decimals === 0
        ? `${symbol} does not support decimal places.`
        : `${symbol} supports at most ${decimals} decimal places.`,
    );
  }

  const raw = parseToBaseUnits(trimmed, decimals);
  if (raw === null) {
    return reject("malformed", `Enter an amount in ${symbol}, using digits only.`);
  }
  if (raw === "0") {
    return reject("zero", "Enter an amount greater than zero.");
  }

  if (minimum !== undefined && compareBaseUnits(raw, minimum) < 0) {
    return reject(
      "below-minimum",
      `The minimum transfer is ${display(minimum, decimals, symbol)}.`,
    );
  }
  if (maximum !== undefined && compareBaseUnits(raw, maximum) > 0) {
    return reject(
      "above-maximum",
      `The maximum transfer is ${display(maximum, decimals, symbol)}.`,
    );
  }

  return { raw, problem: null, message: null };
}

/**
 * "empty" is a problem for submission but not something to shout about while
 * someone is still typing. The form uses this to decide whether to show the
 * message inline.
 */
export function isReportableProblem(problem: AmountProblem | null): boolean {
  return problem !== null && problem !== "empty";
}

/**
 * Render a base-unit bound as it appears in the limits copy, e.g. "1 GLC".
 *
 * Trailing zeros are dropped so a limit of exactly 1 GLC reads as "1 GLC"
 * rather than "1.00000000 GLC".
 */
export function display(raw: string, decimals: number, symbol: string): string {
  try {
    return `${formatBaseUnits(raw, decimals, { minFractionDigits: 0 })} ${symbol}`;
  } catch {
    return `— ${symbol}`;
  }
}

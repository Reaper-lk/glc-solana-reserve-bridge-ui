import { GOLDCOIN_DECIMALS } from "@/lib/config/env";

/**
 * Conversion between a token's own atomic units and the bridge's canonical
 * unit (Goldcoin's 8 decimals — `amount_conversion.rs` in
 * glc-solana-reserve-bridge uses this as the wire unit for every
 * gross/fee/net figure, regardless of direction).
 *
 * Going from fewer decimals to 8 (Solana's 6 -> canonical) is always exact:
 * it is just appending zeros, done here as string concatenation rather than
 * floating-point multiplication so no precision is ever at risk. The
 * reverse is exact only when the trailing digits are actually zero, which
 * holds by construction for any value this module produced itself; for
 * bounds coming from the backend's own limits it is not guaranteed, so
 * `canonicalToSourceRawFloor`/`Ceil` round conservatively instead of
 * assuming exactness.
 */

export function sourceRawToCanonical(sourceRaw: string, sourceDecimals: number): string {
  const pad = GOLDCOIN_DECIMALS - sourceDecimals;
  if (pad < 0)
    throw new Error("source decimals cannot exceed the canonical unit's decimals");
  if (pad === 0) return sourceRaw;
  return `${sourceRaw}${"0".repeat(pad)}`;
}

/** Exact only when `canonical` ends in `pad` zeros — throws otherwise. */
export function canonicalToSourceRawExact(
  canonical: string,
  sourceDecimals: number,
): string {
  const pad = GOLDCOIN_DECIMALS - sourceDecimals;
  if (pad === 0) return canonical;
  const zeros = "0".repeat(pad);
  if (!canonical.endsWith(zeros)) {
    throw new Error(
      "canonical amount is not exactly representable at the source decimals",
    );
  }
  const trimmed = canonical.slice(0, canonical.length - pad);
  return trimmed.length > 0 ? trimmed : "0";
}

export function canonicalToSourceRawFloor(
  canonical: string,
  sourceDecimals: number,
): string {
  const pad = GOLDCOIN_DECIMALS - sourceDecimals;
  if (pad === 0) return canonical;
  const divisor = 10n ** BigInt(pad);
  return (BigInt(canonical) / divisor).toString();
}

export function canonicalToSourceRawCeil(
  canonical: string,
  sourceDecimals: number,
): string {
  const pad = GOLDCOIN_DECIMALS - sourceDecimals;
  if (pad === 0) return canonical;
  const divisor = 10n ** BigInt(pad);
  const value = BigInt(canonical);
  return ((value + divisor - 1n) / divisor).toString();
}

/**
 * General atomic-unit rescaling between two decimal precisions.
 *
 * Needed because the wire carries TWO unit families: gross/fee/net figures
 * are canonical (8 decimals, docs/20-bridge-fee.md), while `/limits` and the
 * rolling-volume quota fields pass the on-chain `BridgeConfig` values
 * through raw — and the on-chain limit checks compare them against
 * mint-atomic amounts (6 decimals; `limits.rs::enforce_transfer_amount`),
 * so those fields are mint-atomic. Rounding direction is the caller's
 * safety decision: ceil a minimum, floor a maximum/remaining, so a rounded
 * bound is never more permissive than the backend's.
 */
export function atomicRescaleFloor(raw: string, from: number, to: number): string {
  if (from === to) return raw;
  if (from < to) return `${raw}${"0".repeat(to - from)}`;
  const divisor = 10n ** BigInt(from - to);
  return (BigInt(raw) / divisor).toString();
}

export function atomicRescaleCeil(raw: string, from: number, to: number): string {
  if (from <= to) return atomicRescaleFloor(raw, from, to);
  const divisor = 10n ** BigInt(from - to);
  return ((BigInt(raw) + divisor - 1n) / divisor).toString();
}

const BPS_DENOMINATOR = 10_000n;

/**
 * The exact smallest GROSS amount, in canonical (8-decimal) atomic units,
 * that guarantees the resulting NET amount clears the on-chain minimum
 * transfer floor (`GET /limits`' `min_transfer_amount`, checked by
 * `limits.rs::enforce_transfer_amount` against the NET amount for
 * GlcToSol's `release_from_reserve`).
 *
 * NOT a general fee/quote calculator (`lib/bridge/index.ts`'s module
 * docs: `POST /quote` remains the sole source of truth for what a given
 * transfer actually nets) — this derives exactly one client-side
 * input-validation BOUND, replicating only the backend's documented,
 * stable fee-rounding CONTRACT (`amount_conversion::compute_fee`: fee
 * floored from a fixed bps rate, integer arithmetic, never floating
 * point) — never used to show the user an authoritative fee/net
 * breakdown. Both `feeBps` and `minTransferAmountMintAtomic` come from
 * `GET /limits` itself, never a hardcoded assumption about either, so
 * this stays correct automatically if the fee rate or the on-chain floor
 * ever changes — replacing a previous fixed "100 GLC" constant that
 * quietly went stale when the real fee moved from 1% to 6% (later 3%) (it no longer
 * guaranteed clearing the real on-chain floor).
 *
 * `net(gross) = gross - floor(gross * feeBps / 10000)` is non-decreasing
 * in `gross` (each +1 to gross increases the floored fee by 0 or 1, so
 * net either holds steady or increases by exactly 1) — binary search over
 * a real-division-ceiling upper bound therefore finds the true minimal
 * integer boundary exactly, not just a safe overshoot.
 *
 * Also safe — over-satisfies, never under-satisfies — for SolToGlc's
 * `deposit_to_reserve`, whose on-chain check applies directly to the raw
 * GROSS deposit amount (no fee has been deducted yet at that point): any
 * gross amount large enough to survive GlcToSol's stricter, fee-adjusted
 * requirement already exceeds `minTransferAmountMintAtomic` before any
 * fee is even considered, so it clears SolToGlc's simpler, unadjusted
 * check too.
 */
export function minimumGrossCanonicalForMinTransferAmount(
  minTransferAmountMintAtomic: string,
  feeBps: number,
  mintDecimals: number,
): string {
  const bps = BigInt(feeBps);
  if (bps < 0n || bps >= BPS_DENOMINATOR) {
    throw new Error("fee_bps must be within [0, 10000)");
  }
  const pad = GOLDCOIN_DECIMALS - mintDecimals;
  if (pad < 0) {
    throw new Error("mint decimals cannot exceed the canonical unit's decimals");
  }
  const minNetCanonical = BigInt(minTransferAmountMintAtomic) * 10n ** BigInt(pad);
  if (minNetCanonical === 0n) return "0";

  const netOf = (gross: bigint) => gross - (gross * bps) / BPS_DENOMINATOR;

  let lo = minNetCanonical; // net(g) <= g always, so g must be at least the target net.
  let hi =
    (minNetCanonical * BPS_DENOMINATOR + (BPS_DENOMINATOR - bps) - 1n) /
    (BPS_DENOMINATOR - bps); // real-division ceiling: always sufficient, not always tightest.
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (netOf(mid) >= minNetCanonical) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo.toString();
}

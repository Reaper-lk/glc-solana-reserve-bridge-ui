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

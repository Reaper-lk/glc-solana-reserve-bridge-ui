import { describe, expect, it } from "vitest";
import {
  atomicRescaleCeil,
  canonicalToSourceRawCeil,
  canonicalToSourceRawExact,
  canonicalToSourceRawFloor,
  minimumGrossCanonicalForMinTransferAmount,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";

/**
 * The bridge's canonical unit is Goldcoin's 8 decimals
 * (`amount_conversion.rs` in glc-solana-reserve-bridge), used for every
 * gross/fee/net figure on the wire regardless of direction. These
 * conversions are what let the frontend enter/validate an amount in a
 * direction's own source decimals (8 for Goldcoin, 6 for Solana) while
 * still talking to the backend in canonical units.
 */
describe("sourceRawToCanonical", () => {
  it("is a no-op at 8 decimals (Goldcoin is already canonical)", () => {
    expect(sourceRawToCanonical("12345678", 8)).toBe("12345678");
  });

  it("widens Solana's 6 decimals by appending two zeros", () => {
    expect(sourceRawToCanonical("100", 6)).toBe("10000");
    expect(sourceRawToCanonical("0", 6)).toBe("000");
  });
});

describe("canonicalToSourceRawExact", () => {
  it("round-trips a widened value exactly", () => {
    const canonical = sourceRawToCanonical("123456", 6);
    expect(canonicalToSourceRawExact(canonical, 6)).toBe("123456");
  });

  it("throws when the canonical value is not exactly representable at 6 decimals", () => {
    expect(() => canonicalToSourceRawExact("12345601", 6)).toThrow();
  });

  it("is a no-op at 8 decimals", () => {
    expect(canonicalToSourceRawExact("42", 8)).toBe("42");
  });
});

describe("canonicalToSourceRawFloor / Ceil", () => {
  it("floor truncates toward zero for a non-exact canonical bound", () => {
    expect(canonicalToSourceRawFloor("12345699", 6)).toBe("123456");
  });

  it("ceil rounds up for a non-exact canonical bound", () => {
    expect(canonicalToSourceRawCeil("12345601", 6)).toBe("123457");
  });

  it("floor and ceil agree on an exact value", () => {
    expect(canonicalToSourceRawFloor("12345600", 6)).toBe("123456");
    expect(canonicalToSourceRawCeil("12345600", 6)).toBe("123456");
  });
});

/**
 * `minimumGrossCanonicalForMinTransferAmount` replaces a previous fixed
 * "100 GLC" UI constant that went silently stale when the real bridge fee
 * moved from 1% to 6% (100 GLC gross nets to only 94 GLC at 6%, under the
 * then-current on-chain minimum). It derives the exact smallest gross
 * amount instead, straight from `GET /limits`' own
 * `min_transfer_amount`/`bridge_fee_bps`, replicating the backend's exact
 * floored-fee formula (`amount_conversion::compute_fee`).
 *
 * At the real production values (99 GLC net-side minimum, 3% fee —
 * docs/22-production-readiness-review.md's 2026-08-29 update note), the
 * exact boundary is 102.06185566 GLC — verified independently by hand:
 * fee(g) = floor(g * 300 / 10000); at g = 10,206,185,566 canonical atomic
 * units, fee = 306,185,566 and net = 9,900,000,000 (exactly 99 GLC); at
 * g - 1 = 10,206,185,565, net drops to 9,899,999,999 (under 99 GLC).
 */
describe("minimumGrossCanonicalForMinTransferAmount", () => {
  const MIN_TRANSFER_AMOUNT_MINT_ATOMIC = "99000000"; // 99 GLC, 6-decimal mint units
  const FEE_BPS = 300; // 3%, the real production rate
  const MINT_DECIMALS = 6;
  const EXACT_MINIMUM_CANONICAL = "10206185566"; // 102.06185566 GLC, canonical (8 dec)

  it("computes the real production boundary exactly (99 GLC min, 3% fee)", () => {
    expect(
      minimumGrossCanonicalForMinTransferAmount(
        MIN_TRANSFER_AMOUNT_MINT_ATOMIC,
        FEE_BPS,
        MINT_DECIMALS,
      ),
    ).toBe(EXACT_MINIMUM_CANONICAL);
  });

  it("the exact minimum nets to exactly the on-chain floor, never more", () => {
    const gross = BigInt(EXACT_MINIMUM_CANONICAL);
    const fee = (gross * 300n) / 10_000n;
    const net = gross - fee;
    // 99 GLC canonical == 99 GLC at 6 decimals * 100 (the canonical/mint
    // decimal-scale factor), i.e. exactly the configured minimum — the
    // tightest possible boundary, not an overshoot.
    expect(net).toBe(BigInt(MIN_TRANSFER_AMOUNT_MINT_ATOMIC) * 100n);
  });

  it("one atomic unit below the computed minimum nets to just under the floor", () => {
    const gross = BigInt(EXACT_MINIMUM_CANONICAL) - 1n;
    const fee = (gross * 300n) / 10_000n;
    const net = gross - fee;
    expect(net).toBeLessThan(BigInt(MIN_TRANSFER_AMOUNT_MINT_ATOMIC) * 100n);
  });

  it("rescales the canonical minimum up (ceil) to Solana's 6-decimal source precision without under-shooting", () => {
    const minimumForSolToGlc = atomicRescaleCeil(EXACT_MINIMUM_CANONICAL, 8, 6);
    expect(minimumForSolToGlc).toBe("102061856");
    // Ceiling, not truncation: the naive floor (102061855) would be
    // slightly BELOW the true canonical minimum once converted back,
    // which would under-shoot the real on-chain floor for SolToGlc.
    const flooredWouldUndershoot = 102061855n * 100n < BigInt(EXACT_MINIMUM_CANONICAL);
    expect(flooredWouldUndershoot).toBe(true);
  });

  it("is a no-op at 8 mint decimals (canonical is already 8 decimals)", () => {
    // A degenerate but structurally valid input: confirms the function
    // does not assume a specific mint decimal count.
    const result = minimumGrossCanonicalForMinTransferAmount("100", 300, 8);
    const gross = BigInt(result);
    const fee = (gross * 300n) / 10_000n;
    expect(gross - fee).toBeGreaterThanOrEqual(100n);
    expect(gross - 1n - ((gross - 1n) * 300n) / 10_000n).toBeLessThan(100n);
  });

  it("returns zero for a zero minimum", () => {
    expect(minimumGrossCanonicalForMinTransferAmount("0", 300, 6)).toBe("0");
  });

  it("rejects a fee rate of 100% or more (division by zero in the derivation)", () => {
    expect(() =>
      minimumGrossCanonicalForMinTransferAmount("100000000", 10_000, 6),
    ).toThrow();
  });

  it("self-corrects if the fee rate changes — never a hardcoded assumption", () => {
    // At 1% (the earlier pilot rate), the boundary is much lower than at
    // 3% — proving the derivation genuinely depends on `feeBps`, not a
    // baked-in constant.
    const at1Percent = BigInt(
      minimumGrossCanonicalForMinTransferAmount(MIN_TRANSFER_AMOUNT_MINT_ATOMIC, 100, 6),
    );
    const at3Percent = BigInt(EXACT_MINIMUM_CANONICAL);
    expect(at1Percent).toBeLessThan(at3Percent);
  });
});

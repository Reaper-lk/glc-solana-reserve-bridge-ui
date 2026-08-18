import { describe, expect, it } from "vitest";
import {
  canonicalToSourceRawCeil,
  canonicalToSourceRawExact,
  canonicalToSourceRawFloor,
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

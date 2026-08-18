import { describe, expect, it } from "vitest";
import {
  AmountFormatError,
  compareBaseUnits,
  formatBaseUnits,
  formatPercent,
  parseToBaseUnits,
} from "@/lib/format/amount";

/**
 * Money-critical (acceptance criterion 15).
 *
 * These functions are the only place a token amount changes representation. A
 * defect here misstates a balance on a screen where someone is about to make an
 * irreversible decision, so the edge cases are covered exhaustively rather than
 * representatively.
 */

describe("formatBaseUnits", () => {
  it("renders whole amounts with the minimum fraction digits", () => {
    expect(formatBaseUnits("10000000000", 8)).toBe("100.00");
  });

  it("groups thousands", () => {
    expect(formatBaseUnits("123456700000000", 8)).toBe("1,234,567.00");
  });

  it("keeps significant fraction digits", () => {
    expect(formatBaseUnits("9970000000", 8)).toBe("99.70");
    expect(formatBaseUnits("123456789", 8)).toBe("1.23456789");
  });

  it("handles amounts smaller than one whole unit", () => {
    expect(formatBaseUnits("1", 8)).toBe("0.00000001");
    expect(formatBaseUnits("30000000", 8)).toBe("0.30");
  });

  it("renders zero without a sign", () => {
    expect(formatBaseUnits("0", 8)).toBe("0.00");
    expect(formatBaseUnits("-0", 8)).toBe("0.00");
  });

  it("supports zero-decimal tokens", () => {
    expect(formatBaseUnits("4210", 0)).toBe("4,210");
  });

  it("truncates rather than rounds, so a balance is never overstated", () => {
    // 1.999999995 must not present as 2.00
    expect(formatBaseUnits("199999999", 8, { maxFractionDigits: 2 })).toBe("1.99");
  });

  it("does not lose precision on values beyond Number.MAX_SAFE_INTEGER", () => {
    // 99,999,999,999,999.99999999 GLC — unrepresentable as a float.
    expect(formatBaseUnits("9999999999999999999999", 8)).toBe(
      "99,999,999,999,999.99999999",
    );
  });

  it("rejects a non-integer input rather than guessing", () => {
    expect(() => formatBaseUnits("1.5", 8)).toThrow(AmountFormatError);
    expect(() => formatBaseUnits("", 8)).toThrow(AmountFormatError);
    expect(() => formatBaseUnits("1e8", 8)).toThrow(AmountFormatError);
  });

  it("rejects impossible precision", () => {
    expect(() => formatBaseUnits("1", -1)).toThrow(AmountFormatError);
    expect(() => formatBaseUnits("1", 1.5)).toThrow(AmountFormatError);
  });
});

describe("parseToBaseUnits", () => {
  it("parses plain and decimal input", () => {
    expect(parseToBaseUnits("100", 8)).toBe("10000000000");
    expect(parseToBaseUnits("99.7", 8)).toBe("9970000000");
    expect(parseToBaseUnits("0.00000001", 8)).toBe("1");
  });

  it("accepts grouped input as typed by a user", () => {
    expect(parseToBaseUnits("1,234.5", 8)).toBe("123450000000");
  });

  it("treats a bare zero and empty fraction consistently", () => {
    expect(parseToBaseUnits("0", 8)).toBe("0");
    expect(parseToBaseUnits("0.", 8)).toBe("0");
    expect(parseToBaseUnits(".5", 8)).toBe("50000000");
  });

  it("refuses more precision than the token has", () => {
    expect(parseToBaseUnits("1.123456789", 8)).toBeNull();
  });

  it("refuses anything that is not a positive decimal", () => {
    expect(parseToBaseUnits("", 8)).toBeNull();
    expect(parseToBaseUnits("-1", 8)).toBeNull();
    expect(parseToBaseUnits("abc", 8)).toBeNull();
    expect(parseToBaseUnits("1.2.3", 8)).toBeNull();
    expect(parseToBaseUnits(".", 8)).toBeNull();
    expect(parseToBaseUnits("1e5", 8)).toBeNull();
  });

  it("round-trips through formatBaseUnits", () => {
    const parsed = parseToBaseUnits("1234.5678", 8);
    expect(parsed).not.toBeNull();
    expect(formatBaseUnits(parsed as string, 8)).toBe("1,234.5678");
  });
});

describe("compareBaseUnits", () => {
  it("orders values without converting to a number", () => {
    expect(compareBaseUnits("100", "200")).toBe(-1);
    expect(compareBaseUnits("200", "100")).toBe(1);
    expect(compareBaseUnits("100", "100")).toBe(0);
  });

  it("stays correct beyond float precision", () => {
    expect(compareBaseUnits("9007199254740993", "9007199254740992")).toBe(1);
  });

  it("rejects malformed input", () => {
    expect(() => compareBaseUnits("1.5", "2")).toThrow(AmountFormatError);
  });
});

describe("formatPercent", () => {
  it("renders a backing ratio at the precision the reserves page needs", () => {
    expect(formatPercent(1.000002)).toBe("100.0002%");
  });

  it("renders an em dash rather than NaN", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

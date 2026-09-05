import { describe, expect, it } from "vitest";
import {
  AmountFormatError,
  compareBaseUnits,
  formatBaseUnits,
  formatDisplayAmount,
  formatDisplayDecimal,
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

  it("truncates rather than rounds by default, so a balance is never overstated", () => {
    // 1.999999995 must not present as 2.00
    expect(formatBaseUnits("199999999", 8, { maxFractionDigits: 2 })).toBe("1.99");
  });

  it("rounds to nearest only when asked", () => {
    expect(
      formatBaseUnits("199999999", 8, { maxFractionDigits: 2, rounding: "nearest" }),
    ).toBe("2.00");
    expect(
      formatBaseUnits("199999999", 8, { maxFractionDigits: 2, rounding: "truncate" }),
    ).toBe("1.99");
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

/**
 * Display precision (the two-decimal surfaces).
 *
 * Summary, stat and value surfaces read for magnitude, so they show exactly
 * two places. The reduction is presentation only: it happens on the way to a
 * string, from the same exact base units every other consumer sees, and
 * nothing upstream of it is rounded, truncated or stored differently.
 */
describe("formatDisplayAmount", () => {
  it("renders the reported explorer figure at two places, rounded", () => {
    // 96,218,058.29927559 GLC — the value that was shown in full.
    expect(formatDisplayAmount("9621805829927559", 8)).toBe("96,218,058.30");
  });

  it("pads a whole amount to two places and keeps thousands separators", () => {
    // 29,100 GLC.
    expect(formatDisplayAmount("2910000000000", 8)).toBe("29,100.00");
  });

  it("renders zero as 0.00", () => {
    expect(formatDisplayAmount("0", 8)).toBe("0.00");
    expect(formatDisplayAmount("-0", 8)).toBe("0.00");
  });

  it("never renders more or fewer than two fraction digits", () => {
    for (const raw of ["0", "1", "50000000", "123456789", "9621805829927559"]) {
      expect(formatDisplayAmount(raw, 8)).toMatch(/^-?[\d,]+\.\d{2}$/);
    }
  });

  it("stays exact on atomic amounts far beyond Number.MAX_SAFE_INTEGER", () => {
    // Past the safe boundary, where a float would already have lost digits.
    expect(formatDisplayAmount("9007199254740993", 8)).toBe("90,071,992.55");
    // u64::MAX.
    expect(formatDisplayAmount("18446744073709551615", 8)).toBe("184,467,440,737.10");
    // A 78-digit atomic value (u256::MAX), formatted without a rounding error.
    expect(
      formatDisplayAmount(
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        8,
      ),
    ).toBe(
      "1,157,920,892,373,161,954,235,709,850,086,879,078,532,699,846,656,405,640,394,575,840,079,131.30",
    );
    // The same magnitude built as a bigint, to show the string is the digits.
    expect(formatDisplayAmount((2n ** 64n - 1n).toString(), 8)).toBe(
      "184,467,440,737.10",
    );
  });

  it("rounds half away from zero, at the boundary", () => {
    expect(formatDisplayAmount("104999999", 8)).toBe("1.05"); // 1.04999999
    expect(formatDisplayAmount("105000000", 8)).toBe("1.05"); // 1.05 exactly
    expect(formatDisplayAmount("100500000", 8)).toBe("1.01"); // 1.005 -> 1.01
    expect(formatDisplayAmount("99999999", 8)).toBe("1.00"); // 0.99999999
    expect(formatDisplayAmount("-100500000", 8)).toBe("-1.01");
  });

  it("does not invent a negative sign for a value that rounds to zero", () => {
    // A dust deficit is not "-0.00".
    expect(formatDisplayAmount("-1", 8)).toBe("0.00");
  });

  it("carries across the whole part", () => {
    expect(formatDisplayAmount("999999999", 8)).toBe("10.00");
    expect(formatDisplayAmount("99999999999", 8)).toBe("1,000.00");
  });

  it("handles a six-decimal mint amount as well as an eight-decimal one", () => {
    // Solana GLC is 6dp; the same figure must read the same on both sides.
    expect(formatDisplayAmount("96218058299275", 6)).toBe("96,218,058.30");
  });

  it("rejects a malformed amount rather than guessing", () => {
    expect(() => formatDisplayAmount("1.5", 8)).toThrow(AmountFormatError);
  });
});

describe("formatDisplayDecimal", () => {
  it("formats the backend's own fixed-point quote strings", () => {
    expect(formatDisplayDecimal("96218058.29927559")).toBe("96,218,058.30");
    expect(formatDisplayDecimal("1000.00000000")).toBe("1,000.00");
    expect(formatDisplayDecimal("0")).toBe("0.00");
    expect(formatDisplayDecimal("7.77000000")).toBe("7.77");
  });

  it("reads the digits exactly, never through a float", () => {
    // Number("9007199254740993.99") loses the final integer digit.
    expect(formatDisplayDecimal("9007199254740993.99")).toBe("9,007,199,254,740,993.99");
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", "1e8", "1,000.00", "abc", "1.2.3", "."]) {
      expect(() => formatDisplayDecimal(bad)).toThrow(AmountFormatError);
    }
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

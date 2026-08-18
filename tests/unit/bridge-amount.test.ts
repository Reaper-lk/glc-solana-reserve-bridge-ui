import { describe, expect, it } from "vitest";
import { display, isReportableProblem, validateAmount } from "@/lib/bridge/amount";

/**
 * Money-critical (acceptance criterion 15).
 *
 * This is the function standing between what someone types and what the bridge
 * is asked to move. Every case below is one a real person will produce: a
 * pasted balance with commas, a fat-fingered `1e5`, a copy from a wallet that
 * shows more decimals than the token has.
 *
 * The rule under test throughout: an input this function cannot represent
 * exactly is refused with a reason. It is never coerced, rounded, or guessed
 * into something plausible.
 */

const GLC = { decimals: 8, symbol: "GLC" } as const;

/** 1 GLC and 50,000 GLC in base units, as `GET /limits` reports them. */
const MIN = "100000000";
const MAX = "5000000000000";

const bounded = { ...GLC, minimum: MIN, maximum: MAX };

describe("validateAmount — well-formed input", () => {
  it("converts a whole number to base units", () => {
    expect(validateAmount("100", bounded).raw).toBe("10000000000");
  });

  it("converts a fractional amount without touching a float", () => {
    expect(validateAmount("100.5", bounded).raw).toBe("10050000000");
  });

  it("accepts precision up to the token's decimals exactly", () => {
    expect(validateAmount("1.00000001", bounded).raw).toBe("100000001");
  });

  it("reads a leading-point value as the fraction it looks like", () => {
    // ".5" is 0.5, which is below the 1 GLC minimum — the point is that it
    // parses as 0.5 rather than being refused as malformed.
    expect(validateAmount(".5", GLC).raw).toBe("50000000");
  });

  it("reads a trailing-point value as the whole number it looks like", () => {
    expect(validateAmount("5.", bounded).raw).toBe("500000000");
  });

  it("strips thousands separators from a pasted balance", () => {
    expect(validateAmount("1,234.5", bounded).raw).toBe("123450000000");
  });

  it("ignores surrounding whitespace", () => {
    expect(validateAmount("  100  ", bounded).raw).toBe("10000000000");
  });

  it("normalises leading zeros", () => {
    expect(validateAmount("007", bounded).raw).toBe("700000000");
  });

  it("keeps a very large amount exact, where a float would not", () => {
    // 90,071,992.54740993 GLC — past Number.MAX_SAFE_INTEGER in base units.
    const result = validateAmount("90071992.54740993", { ...GLC });
    expect(result.raw).toBe("9007199254740993");
    expect(result.problem).toBeNull();
  });

  it("reports no message when the amount is usable", () => {
    const result = validateAmount("100", bounded);
    expect(result.problem).toBeNull();
    expect(result.message).toBeNull();
  });
});

describe("validateAmount — refusals", () => {
  it("treats an empty field as empty, not as an error to shout about", () => {
    const result = validateAmount("", bounded);
    expect(result.problem).toBe("empty");
    expect(result.message).toBeNull();
    expect(isReportableProblem(result.problem)).toBe(false);
  });

  it("treats whitespace alone as empty", () => {
    expect(validateAmount("   ", bounded).problem).toBe("empty");
  });

  it.each([
    ["a bare point", "."],
    ["a negative amount", "-1"],
    ["scientific notation", "1e3"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["hexadecimal", "0x10"],
    ["letters", "abc"],
    ["two points", "1.2.3"],
    ["a trailing sign", "100+"],
    ["a percentage", "50%"],
    ["a currency prefix", "$100"],
    ["a space inside the number", "1 000"],
    ["Arabic-Indic digits", "١٠٠"],
    ["fullwidth digits", "１００"],
  ])("refuses %s", (_label, input) => {
    const result = validateAmount(input, bounded);
    expect(result.raw).toBeNull();
    expect(result.problem).toBe("malformed");
    expect(result.message).toContain("GLC");
  });

  it("refuses more decimals than the token can represent", () => {
    const result = validateAmount("1.000000001", bounded);
    expect(result.problem).toBe("too-many-decimals");
    expect(result.message).toBe("GLC supports at most 8 decimal places.");
  });

  it("refuses any decimal place on a zero-decimals token", () => {
    const result = validateAmount("1.5", { decimals: 0, symbol: "XYZ" });
    expect(result.problem).toBe("too-many-decimals");
    expect(result.message).toBe("XYZ does not support decimal places.");
  });

  it("refuses zero however it is written", () => {
    for (const input of ["0", "0.0", "0.00000000", "00", ".0"]) {
      expect(validateAmount(input, GLC).problem).toBe("zero");
    }
  });

  it("refuses an amount below the published minimum", () => {
    const result = validateAmount("0.5", bounded);
    expect(result.problem).toBe("below-minimum");
    expect(result.message).toBe("The minimum transfer is 1 GLC.");
  });

  it("refuses an amount above the published maximum", () => {
    const result = validateAmount("50000.00000001", bounded);
    expect(result.problem).toBe("above-maximum");
    expect(result.message).toBe("The maximum transfer is 50,000 GLC.");
  });
});

describe("validateAmount — boundaries", () => {
  it("accepts exactly the minimum", () => {
    expect(validateAmount("1", bounded).raw).toBe(MIN);
  });

  it("accepts exactly the maximum", () => {
    expect(validateAmount("50000", bounded).raw).toBe(MAX);
  });

  it("refuses one base unit below the minimum", () => {
    expect(validateAmount("0.99999999", bounded).problem).toBe("below-minimum");
  });

  it("refuses one base unit above the maximum", () => {
    expect(validateAmount("50000.00000001", bounded).problem).toBe("above-maximum");
  });
});

describe("validateAmount — absent bounds", () => {
  /**
   * `minAmount` and `maxAmount` are optional in the limits schema. A bridge
   * that publishes no cap must render no cap — substituting a default here
   * would invent policy the protocol never stated.
   */

  it("accepts an enormous amount when no maximum is published", () => {
    const result = validateAmount("999999999999", { ...GLC, minimum: MIN });
    expect(result.problem).toBeNull();
  });

  it("accepts a tiny amount when no minimum is published", () => {
    const result = validateAmount("0.00000001", { ...GLC, maximum: MAX });
    expect(result.raw).toBe("1");
    expect(result.problem).toBeNull();
  });

  it("still refuses zero when nothing is published", () => {
    expect(validateAmount("0", GLC).problem).toBe("zero");
  });
});

describe("isReportableProblem", () => {
  it("is false for no problem and for an untouched field", () => {
    expect(isReportableProblem(null)).toBe(false);
    expect(isReportableProblem("empty")).toBe(false);
  });

  it("is true for anything the user needs to fix", () => {
    for (const problem of [
      "malformed",
      "too-many-decimals",
      "zero",
      "below-minimum",
      "above-maximum",
    ] as const) {
      expect(isReportableProblem(problem)).toBe(true);
    }
  });
});

describe("display", () => {
  it("drops trailing zeros so a round limit reads as a round number", () => {
    expect(display(MIN, 8, "GLC")).toBe("1 GLC");
  });

  it("groups thousands", () => {
    expect(display(MAX, 8, "GLC")).toBe("50,000 GLC");
  });

  it("keeps significant fraction digits", () => {
    expect(display("150000000", 8, "GLC")).toBe("1.5 GLC");
  });

  it("renders unavailable rather than throwing on a malformed value", () => {
    expect(display("not-a-number", 8, "GLC")).toBe("— GLC");
  });
});

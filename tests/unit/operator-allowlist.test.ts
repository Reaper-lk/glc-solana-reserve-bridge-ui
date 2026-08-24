import { describe, expect, it } from "vitest";
import {
  isAuthorizedOperator,
  parseOperatorAllowlist,
} from "@/lib/security/operator-allowlist";

const OPERATOR_A = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const OPERATOR_B = "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY";
const UNAUTHORIZED = "11111111111111111111111111111112";

describe("isAuthorizedOperator — unauthorized users cannot use the funding page", () => {
  const allowlist = `${OPERATOR_A}, ${OPERATOR_B}`;

  it("authorizes an address on the allowlist", () => {
    expect(isAuthorizedOperator(OPERATOR_A, allowlist)).toBe(true);
    expect(isAuthorizedOperator(OPERATOR_B, allowlist)).toBe(true);
  });

  it("refuses an address not on the allowlist", () => {
    expect(isAuthorizedOperator(UNAUTHORIZED, allowlist)).toBe(false);
  });

  it("fails closed when the allowlist is unset — authorizes nobody, never everyone", () => {
    expect(isAuthorizedOperator(OPERATOR_A, undefined)).toBe(false);
    expect(isAuthorizedOperator(OPERATOR_A, "")).toBe(false);
  });

  it("refuses a missing or empty address regardless of the allowlist", () => {
    expect(isAuthorizedOperator(null, allowlist)).toBe(false);
    expect(isAuthorizedOperator(undefined, allowlist)).toBe(false);
    expect(isAuthorizedOperator("", allowlist)).toBe(false);
    expect(isAuthorizedOperator("   ", allowlist)).toBe(false);
  });

  it("is not fooled by a substring match", () => {
    // A naive `.includes()` on the raw CSV string would wrongly authorize
    // this — the allowlist must be parsed into discrete entries first.
    expect(isAuthorizedOperator(OPERATOR_A.slice(0, 10), allowlist)).toBe(false);
  });
});

describe("parseOperatorAllowlist", () => {
  it("trims whitespace and drops empty entries", () => {
    expect(parseOperatorAllowlist(` ${OPERATOR_A} , , ${OPERATOR_B} `)).toEqual(
      new Set([OPERATOR_A, OPERATOR_B]),
    );
  });

  it("returns an empty set for an unset allowlist", () => {
    expect(parseOperatorAllowlist(undefined)).toEqual(new Set());
    expect(parseOperatorAllowlist("")).toEqual(new Set());
  });
});

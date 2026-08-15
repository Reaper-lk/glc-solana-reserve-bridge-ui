import { describe, expect, it } from "vitest";
import {
  __resetConnectionForTests,
  getConnection,
  isMintConfigured,
  isWalletConfigured,
} from "@/lib/solana/connection";

describe("wallet configuration flags", () => {
  it("is not configured in the test environment (no NEXT_PUBLIC_SOLANA_RPC_URL)", () => {
    expect(isWalletConfigured()).toBe(false);
    expect(getConnection()).toBeNull();
  });

  it("the reserve mint is always configured (a public default exists)", () => {
    expect(isMintConfigured()).toBe(true);
  });

  it("__resetConnectionForTests clears the cached connection without throwing", () => {
    expect(() => __resetConnectionForTests()).not.toThrow();
  });
});

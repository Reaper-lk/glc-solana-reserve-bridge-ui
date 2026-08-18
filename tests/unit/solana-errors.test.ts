import { describe, expect, it } from "vitest";
import {
  WalletConnectionError,
  WalletDisconnectedError,
  WalletError,
  WalletNotReadyError,
  WalletTimeoutError,
  WalletWindowBlockedError,
  WalletWindowClosedError,
} from "@solana/wallet-adapter-base";
import { isUserRejection, toWalletFailure } from "@/lib/solana/errors";

describe("toWalletFailure", () => {
  it("classifies WalletNotReadyError as not-installed, non-retryable", () => {
    const failure = toWalletFailure(new WalletNotReadyError());
    expect(failure.code).toBe("not-installed");
    expect(failure.retryable).toBe(false);
  });

  it("classifies a closed approval window as user-rejected", () => {
    const failure = toWalletFailure(new WalletWindowClosedError());
    expect(failure.code).toBe("user-rejected");
    expect(failure.retryable).toBe(true);
  });

  it("classifies a blocked approval window as user-rejected", () => {
    expect(toWalletFailure(new WalletWindowBlockedError()).code).toBe("user-rejected");
  });

  it("classifies WalletTimeoutError as timeout", () => {
    expect(toWalletFailure(new WalletTimeoutError()).code).toBe("timeout");
  });

  it("classifies WalletDisconnectedError as connection-failed", () => {
    expect(toWalletFailure(new WalletDisconnectedError()).code).toBe("connection-failed");
  });

  it("classifies a WalletConnectionError by message content", () => {
    expect(
      toWalletFailure(new WalletConnectionError("User rejected the request")).code,
    ).toBe("user-rejected");
    expect(toWalletFailure(new WalletConnectionError("network unreachable")).code).toBe(
      "connection-failed",
    );
  });

  it("classifies a generic WalletError by message content", () => {
    expect(toWalletFailure(new WalletError("user declined")).code).toBe("user-rejected");
    expect(toWalletFailure(new WalletError("boom")).code).toBe("connection-failed");
  });

  it("classifies a plain Error whose message looks like a rejection", () => {
    expect(toWalletFailure(new Error("User cancelled")).code).toBe("user-rejected");
  });

  it("classifies anything else as unknown, retryable", () => {
    const failure = toWalletFailure("not even an Error");
    expect(failure.code).toBe("unknown");
    expect(failure.retryable).toBe(true);
  });

  it("never states a funds impact other than 'nothing moved'", () => {
    for (const error of [
      new WalletNotReadyError(),
      new WalletTimeoutError(),
      new Error("whatever"),
    ]) {
      expect(toWalletFailure(error).funds).toMatch(/no funds moved/i);
    }
  });
});

describe("isUserRejection", () => {
  it("is true only for the user-rejected code", () => {
    expect(isUserRejection(toWalletFailure(new WalletWindowClosedError()))).toBe(true);
    expect(isUserRejection(toWalletFailure(new WalletNotReadyError()))).toBe(false);
  });

  it("is false for null", () => {
    expect(isUserRejection(null)).toBe(false);
  });
});

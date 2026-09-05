import { describe, expect, it } from "vitest";
import { MockBridgeClient } from "@/lib/api/mock/client";
import { isApiError } from "@/lib/api/errors";

describe("MockBridgeClient — quote / fee presentation", () => {
  it("computes exactly a 3% (300 bps) fee for GlcToSol", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "GlcToSol",
      gross_amount: "100000000000",
    });
    expect(quote.fee_bps).toBe(300);
    expect(quote.fee_amount).toBe("3000000000");
    expect(quote.net_amount).toBe("97000000000");
    expect(BigInt(quote.gross_amount)).toBe(
      BigInt(quote.fee_amount) + BigInt(quote.net_amount),
    );
  });

  it("computes the same 3% fee for SolToGlc", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "SolToGlc",
      gross_amount: "50000000000",
    });
    expect(quote.fee_amount).toBe("1500000000");
    expect(quote.net_amount).toBe("48500000000");
  });

  it("calculates the 3% fee correctly for a normal 2,000 GLC transfer", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "GlcToSol",
      gross_amount: "200000000000",
    });
    expect(quote.fee_bps).toBe(300);
    expect(quote.fee_amount).toBe("6000000000");
    expect(quote.net_amount).toBe("194000000000");
    expect(BigInt(quote.gross_amount)).toBe(
      BigInt(quote.fee_amount) + BigInt(quote.net_amount),
    );
  });

  it("calculates the 3% fee at the 20,000 GLC per-transfer maximum: 19,400 GLC net", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "GlcToSol",
      gross_amount: "2000000000000",
    });
    expect(quote.fee_bps).toBe(300);
    expect(quote.fee_amount).toBe("60000000000");
    expect(quote.net_amount).toBe("1940000000000");
    expect(BigInt(quote.gross_amount)).toBe(
      BigInt(quote.fee_amount) + BigInt(quote.net_amount),
    );
  });

  it("rejects a zero gross amount", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    await expect(
      client.getQuote({ direction: "GlcToSol", gross_amount: "0" }),
    ).rejects.toThrow();
  });
});

describe("MockBridgeClient — SolToGlc recipient eligibility", () => {
  it("reports every recipient eligible (the mock records no SolToGlc payouts) through the real schema", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const out = await client.getSolToGlcRecipientEligibility("  GLCAddr111  ", null);
    expect(out).toMatchObject({
      direction: "SolToGlc",
      address: "GLCAddr111", // trimmed, like the real endpoint
      wallet: null,
      eligible: true,
      blocked_reason: null,
      retry_after: null,
      retry_after_seconds: null,
      window_seconds: 86_400,
    });
  });

  it("echoes a connected wallet back and still reports eligible (the mock records no SolToGlc deposits)", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const out = await client.getSolToGlcRecipientEligibility(
      "GLCAddr111",
      "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    );
    expect(out).toMatchObject({
      wallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      eligible: true,
      blocked_reason: null,
    });
  });
});

describe("MockBridgeClient — direction availability / reserve scenarios", () => {
  it("operational scenario: both directions available, positive capacity", async () => {
    const client = new MockBridgeClient({ latencyMs: 0, scenario: "operational" });
    const status = await client.getStatus();
    expect(status.glc_to_sol_available).toBe(true);
    expect(status.sol_to_glc_available).toBe(true);
    const reserve = await client.getReserve();
    expect(BigInt(reserve.solana_available_capacity)).toBeGreaterThan(0n);
  });

  it("paused scenario: createTransfer is refused with the single direction-unavailable 409", async () => {
    const client = new MockBridgeClient({ latencyMs: 0, scenario: "paused" });
    const status = await client.getStatus();
    expect(status.solana_paused).toBe(true);

    try {
      await client.createTransfer({ amount_atomic: "10000000000", recipient: "someone" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("direction-unavailable");
    }
  });

  it("insufficient-liquidity scenario: createTransfer is refused with the same direction-unavailable 409", async () => {
    const client = new MockBridgeClient({
      latencyMs: 0,
      scenario: "insufficient-liquidity",
    });
    const reserve = await client.getReserve();
    // Exact atomic strings — compared as bigints, never as numbers.
    expect(BigInt(reserve.solana_available_capacity)).toBeLessThan(
      BigInt(reserve.goldcoin_available_capacity),
    );

    try {
      await client.createTransfer({ amount_atomic: "10000000000", recipient: "someone" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("direction-unavailable");
    }
  });
});

describe("MockBridgeClient — transfer lifecycle and lookup", () => {
  it("createTransfer then getTransfer round-trips the same figures", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const created = await client.createTransfer({
      amount_atomic: "20000000000",
      recipient: "abc",
    });
    const transfer = await client.getTransfer(created.request_id);
    expect(transfer.gross_amount_atomic).toBe("20000000000");
    expect(transfer.fee_amount_atomic).toBe("600000000");
    expect(transfer.state).toBe("AwaitingDeposit");
  });

  it("getTransfer on an unknown id throws not-found", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    try {
      await client.getTransfer(999_999);
      expect.unreachable("getTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("not-found");
    }
  });
});

describe("MockBridgeClient — list endpoints paginate through the real envelope", () => {
  it("listTransfers returns the Page<T> envelope shape", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const page = await client.listTransfers({ limit: 3 });
    expect(page).toHaveProperty("items");
    expect(page).toHaveProperty("next_cursor");
    expect(page).toHaveProperty("as_of");
  });

  it("listTransfers filters by state", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const page = await client.listTransfers({ state: "Settled" });
    expect(page.items.every((item) => item.state === "Settled")).toBe(true);
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("listExplorerEvents filters by direction", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const page = await client.listExplorerEvents({ direction: "GlcToSol" });
    expect(page.items.every((item) => item.direction === "GlcToSol")).toBe(true);
  });

  it("listReserveHistory filters by reserve", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const page = await client.listReserveHistory({ direction: "solana" });
    expect(page.items.every((item) => item.direction === "SolanaReserve")).toBe(true);
  });

  it("empty result set is a real empty array, not an error", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const page = await client.listTransfers({ state: "DestinationConfirmed" });
    expect(page.items).toEqual([]);
  });
});

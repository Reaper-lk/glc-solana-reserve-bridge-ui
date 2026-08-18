import { describe, expect, it } from "vitest";
import { MockBridgeClient } from "@/lib/api/mock/client";
import { isApiError } from "@/lib/api/errors";

describe("MockBridgeClient — quote / fee presentation", () => {
  it("computes exactly a 1% (100 bps) fee for GlcToSol", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "GlcToSol",
      gross_amount: 1_000_00000000,
    });
    expect(quote.fee_bps).toBe(100);
    expect(quote.fee_amount).toBe(10_00000000);
    expect(quote.net_amount).toBe(990_00000000);
    expect(quote.gross_amount).toBe(quote.fee_amount + quote.net_amount);
  });

  it("computes the same 1% fee for SolToGlc", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const quote = await client.getQuote({
      direction: "SolToGlc",
      gross_amount: 500_00000000,
    });
    expect(quote.fee_amount).toBe(5_00000000);
    expect(quote.net_amount).toBe(495_00000000);
  });

  it("rejects a zero gross amount", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    await expect(
      client.getQuote({ direction: "GlcToSol", gross_amount: 0 }),
    ).rejects.toThrow();
  });
});

describe("MockBridgeClient — direction availability / reserve scenarios", () => {
  it("operational scenario: both directions available, positive capacity", async () => {
    const client = new MockBridgeClient({ latencyMs: 0, scenario: "operational" });
    const status = await client.getStatus();
    expect(status.glc_to_sol_available).toBe(true);
    expect(status.sol_to_glc_available).toBe(true);
    const reserve = await client.getReserve();
    expect(reserve.solana_available_capacity).toBeGreaterThan(0);
  });

  it("paused scenario: createTransfer is refused with a paused error", async () => {
    const client = new MockBridgeClient({ latencyMs: 0, scenario: "paused" });
    const status = await client.getStatus();
    expect(status.solana_paused).toBe(true);

    try {
      await client.createTransfer({ amount_atomic: 100_00000000, recipient: "someone" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("paused");
    }
  });

  it("insufficient-liquidity scenario: createTransfer is refused with that error kind", async () => {
    const client = new MockBridgeClient({
      latencyMs: 0,
      scenario: "insufficient-liquidity",
    });
    const reserve = await client.getReserve();
    expect(reserve.solana_available_capacity).toBeLessThan(
      reserve.goldcoin_available_capacity,
    );

    try {
      await client.createTransfer({ amount_atomic: 100_00000000, recipient: "someone" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("insufficient-liquidity");
    }
  });
});

describe("MockBridgeClient — transfer lifecycle and lookup", () => {
  it("createTransfer then getTransfer round-trips the same figures", async () => {
    const client = new MockBridgeClient({ latencyMs: 0 });
    const created = await client.createTransfer({
      amount_atomic: 200_00000000,
      recipient: "abc",
    });
    const transfer = await client.getTransfer(created.request_id);
    expect(transfer.gross_amount_atomic).toBe(200_00000000);
    expect(transfer.fee_amount_atomic).toBe(2_00000000);
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

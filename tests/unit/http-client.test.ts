import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBridgeClient } from "@/lib/api/http";
import { isApiError } from "@/lib/api/errors";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * A response that does not match its schema must be treated as an outage,
 * not as data. These tests assert the real backend's actual response
 * shapes (`{ "error": string }`, no structured error code, 409 covering two
 * distinct conditions distinguished only by message text) map to the
 * correct `ApiError.kind`.
 */

const BASE = "https://api.example.test";

function respondOk(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }),
  );
}

function respondError(status: number, errorMessage: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: errorMessage }),
      text: async () => JSON.stringify({ error: errorMessage }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpBridgeClient", () => {
  it("returns parsed data for a valid response", async () => {
    respondOk(fixtures.statusFixture(() => new Date()));
    const client = new HttpBridgeClient(BASE);
    const status = await client.getStatus();
    expect(status.glc_to_sol_available).toBe(true);
  });

  it("normalises a trailing slash in the base URL", async () => {
    respondOk(fixtures.statusFixture(() => new Date()));
    const client = new HttpBridgeClient(`${BASE}/`);
    await client.getStatus();
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE}/status`);
  });

  it("never sends credentials", async () => {
    respondOk(fixtures.statusFixture(() => new Date()));
    await new HttpBridgeClient(BASE).getStatus();
    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init).toMatchObject({ credentials: "omit" });
  });

  it("rejects a response that does not match its schema (validation error, never rendered as data)", async () => {
    respondOk({ not: "a real status" });
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getStatus();
      expect.unreachable("getStatus should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("validation");
    }
  });

  it("maps 404 to not-found", async () => {
    respondError(404, "no transfer with id 5");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getTransfer(5);
      expect.unreachable("getTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("not-found");
    }
  });

  it("maps a 409 with 'paused' in the message to kind paused", async () => {
    respondError(409, "the destination reserve is paused");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: 100, recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("paused");
    }
  });

  it("maps a 409 without 'paused' in the message to insufficient-liquidity", async () => {
    respondError(
      409,
      "the destination reserve cannot currently cover this amount (available: 5)",
    );
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: 100, recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("insufficient-liquidity");
    }
  });

  it("maps 400 to bad-request", async () => {
    respondError(400, "amount_atomic must be greater than zero");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: 100, recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("bad-request");
    }
  });

  it("maps 500 to server (retryable)", async () => {
    respondError(500, "internal ledger error");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getStatus();
      expect.unreachable("getStatus should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.kind).toBe("server");
        expect(error.retryable).toBe(true);
      }
    }
  });

  it("maps a network failure to a retryable network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getStatus();
      expect.unreachable("getStatus should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) {
        expect(error.kind).toBe("network");
        expect(error.retryable).toBe(true);
      }
    }
  });

  it("falls back to a status-only message when the error body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "<html>not json</html>",
      }),
    );
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getStatus();
      expect.unreachable("getStatus should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("server");
    }
  });

  it("treats an unexpected success status (e.g. 200 where 201 was required) as a server error", async () => {
    respondOk(fixtures.transfersFixture()[0], 200);
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: 100, recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("server");
    }
  });

  it("exercises every remaining read endpoint against a real response shape", async () => {
    const client = new HttpBridgeClient(BASE);

    respondOk(fixtures.limitsFixture());
    await expect(client.getLimits()).resolves.toMatchObject({ bridge_fee_bps: 100 });

    respondOk(fixtures.reserveFixture());
    await expect(client.getReserve()).resolves.toHaveProperty(
      "solana_available_capacity",
    );

    respondOk(fixtures.healthFixture());
    await expect(client.getHealth()).resolves.toMatchObject({ healthy: true });

    respondOk(fixtures.statsFixture());
    await expect(client.getStats()).resolves.toHaveProperty("glc_to_sol");

    respondOk({ items: fixtures.transfersFixture(), next_cursor: null, as_of: 0 });
    await expect(
      client.listTransfers({ address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" }),
    ).resolves.toHaveProperty("items");

    respondOk({ items: fixtures.explorerEventsFixture(), next_cursor: null, as_of: 0 });
    await expect(
      client.listExplorerEvents({ direction: "GlcToSol" }),
    ).resolves.toHaveProperty("items");

    respondOk({ items: fixtures.reserveHistoryFixture(), next_cursor: null, as_of: 0 });
    await expect(
      client.listReserveHistory({ direction: "solana" }),
    ).resolves.toHaveProperty("items");
  });

  it("normalises the 'resource' fallback description for a non-transfer 404", async () => {
    respondError(404, "not found");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.getLimits();
      expect.unreachable("getLimits should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.message).toMatch(/resource not found/i);
    }
  });
});

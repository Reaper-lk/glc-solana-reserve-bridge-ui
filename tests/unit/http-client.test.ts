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

  it("maps a 409 to the single direction-unavailable kind (the backend's message is cause-agnostic)", async () => {
    respondError(409, "the destination reserve is paused");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: "100", recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("direction-unavailable");
    }
  });

  it("maps every 409 to direction-unavailable regardless of message text", async () => {
    respondError(
      409,
      "the destination reserve cannot currently cover this amount (available: 5)",
    );
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: "100", recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("direction-unavailable");
    }
  });

  it("maps 400 to bad-request", async () => {
    respondError(400, "amount_atomic must be greater than zero");
    const client = new HttpBridgeClient(BASE);
    try {
      await client.createTransfer({ amount_atomic: "100", recipient: "x" });
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
      await client.createTransfer({ amount_atomic: "100", recipient: "x" });
      expect.unreachable("createTransfer should have thrown");
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.kind).toBe("server");
    }
  });

  it("exercises every remaining read endpoint against a real response shape", async () => {
    const client = new HttpBridgeClient(BASE);

    respondOk(fixtures.limitsFixture());
    await expect(client.getLimits()).resolves.toMatchObject({ bridge_fee_bps: 300 });

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

    respondOk({
      direction: "SolToGlc",
      address: "GLCRecipient1111111111111111111111",
      wallet: null,
      eligible: false,
      blocked_reason: "recipient_rate_limited",
      retry_after: 1_787_000_000,
      retry_after_seconds: 40_000,
      window_seconds: 86_400,
    });
    await expect(
      client.getSolToGlcRecipientEligibility("GLCRecipient1111111111111111111111", null),
    ).resolves.toMatchObject({ eligible: false, retry_after: 1_787_000_000 });
    // GET with the address as a query parameter — the exact path the
    // backend routes (`/recipients/sol-to-glc/eligibility?address=`).
    // `wallet` is omitted from the query string when `null`.
    const [eligibilityUrl] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
    expect(String(eligibilityUrl)).toBe(
      `${BASE}/recipients/sol-to-glc/eligibility?address=GLCRecipient1111111111111111111111`,
    );

    respondOk({
      direction: "SolToGlc",
      address: "GLCRecipient1111111111111111111111",
      wallet: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
      retry_after: 1_787_000_000,
      retry_after_seconds: 40_000,
      window_seconds: 86_400,
    });
    await expect(
      client.getSolToGlcRecipientEligibility(
        "GLCRecipient1111111111111111111111",
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      ),
    ).resolves.toMatchObject({
      eligible: false,
      blocked_reason: "source_wallet_rate_limited",
    });
    // When a wallet IS given, it is appended as its own query parameter.
    const [walletEligibilityUrl] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
    expect(String(walletEligibilityUrl)).toBe(
      `${BASE}/recipients/sol-to-glc/eligibility?address=GLCRecipient1111111111111111111111&wallet=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM`,
    );
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

/**
 * The production incident this guards against: the backend began emitting
 * the `Refund*` lifecycle, and a client whose enum predated those states
 * rejected the whole `/explorer/events` payload — turning a page of
 * hundreds of readable events into an outage.
 */
describe("HttpBridgeClient — /explorer/events survives a state this build predates", () => {
  const page = (items: unknown[]) => ({ items, next_cursor: null, as_of: 0 });

  it("parses the real production refund transitions", async () => {
    const base = fixtures.explorerEventsFixture()[0]!;
    respondOk(
      page([
        {
          ...base,
          id: 1,
          from_state: "ManualReview",
          to_state: "RefundPending",
          reason: "glc_refund_started",
        },
        {
          ...base,
          id: 2,
          from_state: "RefundPending",
          to_state: "RefundBroadcast",
          reason: "glc_refund_broadcast",
        },
        {
          ...base,
          id: 3,
          from_state: "RefundBroadcast",
          to_state: "Refunded",
          reason: null,
        },
      ]),
    );
    const client = new HttpBridgeClient(BASE);
    const result = await client.listExplorerEvents({});
    expect(result.items.map((e) => e.to_state)).toEqual([
      "RefundPending",
      "RefundBroadcast",
      "Refunded",
    ]);
  });

  it("keeps every other event when one carries an unknown future state", async () => {
    const [first, second, third] = fixtures.explorerEventsFixture();
    respondOk(page([first, { ...second, to_state: "SomeFutureLifecycleState" }, third]));
    const client = new HttpBridgeClient(BASE);
    const result = await client.listExplorerEvents({});
    expect(result.items).toHaveLength(3);
    expect(result.items[1]!.to_state).toBe("SomeFutureLifecycleState");
  });

  it("still fails the page for a genuinely malformed event", async () => {
    const [first, second] = fixtures.explorerEventsFixture();
    respondOk(page([first, { ...second, to_state: 42 }]));
    const client = new HttpBridgeClient(BASE);
    await expect(client.listExplorerEvents({})).rejects.toSatisfy(isApiError);
  });
});

describe("HttpBridgeClient — timeout composition", () => {
  it("keeps the default client timeout at 15 seconds", async () => {
    const { DEFAULT_TIMEOUT_MS } = await import("@/lib/api/http");
    expect(DEFAULT_TIMEOUT_MS).toBe(15_000);
  });

  it("a caller-supplied signal aborts a hanging request early without changing the default", async () => {
    // fetch honors the composed signal exactly like the real network stack.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(init.signal.reason), {
              once: true,
            });
          }),
      ),
    );
    const client = new HttpBridgeClient(BASE);
    const started = Date.now();
    await expect(client.getStatus(AbortSignal.timeout(100))).rejects.toBeTruthy();
    // Far below the 15s default: the caller's signal, not the client's,
    // ended the request.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

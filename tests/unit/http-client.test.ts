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

    // `GET /robinhood/reserve` — the third reserve, its custody contract's
    // rolling windows and its indexer, on a path of its own so a client
    // that never heard of Robinhood sees no change at all.
    respondOk(fixtures.robinhoodReserveFixture(() => new Date(), { open: true }));
    await expect(client.getRobinhoodReserve()).resolves.toMatchObject({
      ledger_availability: "available",
    });
    const [robinhoodUrl] = vi.mocked(fetch).mock.calls.at(-1) ?? [];
    expect(String(robinhoodUrl)).toBe(`${BASE}/robinhood/reserve`);

    // And the shape a deployment with no `[reserve.robinhood]` section
    // actually returns: nulls throughout, never zeroes.
    respondOk(fixtures.robinhoodReserveFixture(() => new Date(), { open: false }));
    await expect(client.getRobinhoodReserve()).resolves.toMatchObject({
      ledger_availability: "not_configured",
      balance_atomic: null,
      paused: null,
    });

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

/**
 * `getRouteEligibility` against the REAL client — the one production uses.
 *
 * This is where the fail-closed guarantee actually lives. The fixture
 * client answers all six routes so the app can be exercised without a
 * backend; that is a statement about fixtures. What matters for
 * production is that the HTTP client only ever reports a clearance the
 * backend itself gave, and refuses otherwise.
 */
describe("HttpBridgeClient — rolling-24h eligibility", () => {
  const GLC = "GdKQNBb8CVhFxKC1kBi1AjgTQTgLPvVp7c";
  const SOL_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const EVM_CHECKSUMMED = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
  /** How the backend echoes it back — canonicalized before the window is keyed. */
  const EVM_LOWER = EVM_CHECKSUMMED.toLowerCase();

  /** One leg of a `RouteWalletEligibilityView`, as the backend serves it. */
  function legBody(address: string, overrides: Record<string, unknown> = {}) {
    return {
      address,
      eligible: true,
      reason: null,
      retry_after: null,
      retry_after_seconds: null,
      ...overrides,
    };
  }

  /** A `GET /routes/{route}/eligibility` body. A `null` leg was not evaluated. */
  function routeBody(
    route: string,
    source: ReturnType<typeof legBody> | null,
    destination: ReturnType<typeof legBody> | null,
    eligible = true,
  ) {
    return {
      route,
      source,
      destination,
      eligible,
      blocked_reason: null,
      blocked_reasons: [],
      retry_after: null,
      retry_after_seconds: null,
      window_seconds: 86_400,
      as_of: 1_787_000_000,
    };
  }

  function recipientBody(direction: "SolToGlc" | "RhnToGlc", wallet: string | null) {
    return {
      direction,
      address: GLC,
      wallet,
      eligible: true,
      blocked_reason: null,
      blocked_reasons: [],
      retry_after: null,
      retry_after_seconds: null,
      source_wallet_retry_after: null,
      recipient_retry_after: null,
      window_seconds: 86_400,
    };
  }

  it("asks the per-route endpoint for SolToGlc, destination as ?address= and source as ?wallet=", async () => {
    respondOk(recipientBody("SolToGlc", SOL_WALLET));
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "SolToGlc",
      SOL_WALLET,
      GLC,
    );
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${BASE}/recipients/sol-to-glc/eligibility?address=${GLC}&wallet=${SOL_WALLET}`,
    );
    // Normalised by side, not passed through raw.
    expect(answer.sourceSide).toMatchObject({ evaluated: true, eligible: true });
    expect(answer.destinationSide).toMatchObject({ evaluated: true, eligible: true });
    expect(answer.eligible).toBe(true);
  });

  it("asks the per-route endpoint for RhnToGlc", async () => {
    respondOk(recipientBody("RhnToGlc", "0xdd870fa1b7c4700f2bd7f44238821c26f7392148"));
    await new HttpBridgeClient(BASE).getRouteEligibility(
      "RhnToGlc",
      "0xdD870fA1b7C4700F2BD7f44238821C26f7392148",
      GLC,
    );
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/recipients/rhn-to-glc/eligibility");
  });

  it("asks the route-generic endpoint, with the route in the PATH", async () => {
    // The bug this replaces: the client asked `GET /eligibility?route=…`,
    // an endpoint that never shipped. Every request 404'd, which the form
    // reported as "eligibility check temporarily unavailable" on all four
    // routes with no `/recipients/*` path.
    respondOk(routeBody("RhnToSol", legBody(EVM_LOWER), legBody(SOL_WALLET)));
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "RhnToSol",
      EVM_CHECKSUMMED,
      SOL_WALLET,
    );
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/routes/RhnToSol/eligibility?");
    expect(String(url)).not.toContain("route=RhnToSol");
    expect(String(url)).toContain(`destination=${SOL_WALLET}`);
    expect(String(url)).toContain(`source=${EVM_CHECKSUMMED}`);
    expect(answer.eligible).toBe(true);
    expect(answer.asOf).toBe(1_787_000_000);
  });

  it("asks GlcToRhn about the DESTINATION ONLY, and reads the answer as eligible", async () => {
    // A Goldcoin-funded route: the user sends to an address the backend
    // issues, so the browser never learns the source wallet and must not
    // invent one. The backend answers `source: null`, and that is a side
    // with no question rather than a failed check.
    respondOk(routeBody("GlcToRhn", null, legBody(EVM_LOWER)));
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "GlcToRhn",
      null,
      EVM_CHECKSUMMED,
    );
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/routes/GlcToRhn/eligibility?");
    expect(String(url)).not.toContain("source=");
    expect(answer.sourceSide).toMatchObject({ applicable: false });
    expect(answer.source).toBeNull();
    expect(answer.destinationSide).toMatchObject({ evaluated: true, eligible: true });
    expect(answer.eligible).toBe(true);
  });

  it("asks GlcToSol about the destination only, the same way", async () => {
    respondOk(routeBody("GlcToSol", null, legBody(SOL_WALLET)));
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "GlcToSol",
      null,
      SOL_WALLET,
    );
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("/routes/GlcToSol/eligibility?");
    expect(String(url)).not.toContain("source=");
    expect(answer.eligible).toBe(true);
    expect(answer.sourceSide.applicable).toBe(false);
  });

  it("omits ?source= entirely rather than sending it blank", async () => {
    // A blank value is not "no wallet"; it is the one spelling the
    // backend's address parsers would have to reject.
    respondOk(routeBody("GlcToSol", null, legBody(SOL_WALLET)));
    await new HttpBridgeClient(BASE).getRouteEligibility("GlcToSol", null, SOL_WALLET);
    const [url] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).not.toContain("source=");
  });

  it("REFUSES a null source leg on a route whose source wallet the browser DOES know", async () => {
    // Fails closed: the exemption above is about a wallet that cannot
    // exist, never about one the check merely failed to ask about.
    respondOk(routeBody("SolToRhn", null, legBody(EVM_LOWER)));
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "SolToRhn",
      SOL_WALLET,
      EVM_CHECKSUMMED,
    );
    expect(answer.sourceSide).toMatchObject({ evaluated: false, applicable: true });
    expect(answer.eligible).toBe(false);
  });

  it("REFUSES when the deployment does not serve the route-generic endpoint", async () => {
    // A deployment predating it. A 404 is not an answer, and the form
    // refuses.
    respondError(404, "not found");
    await expect(
      new HttpBridgeClient(BASE).getRouteEligibility("SolToRhn", SOL_WALLET, GLC),
    ).rejects.toMatchObject({ name: "EligibilityEndpointUnpublishedError" });
  });

  it("refuses a 5xx rather than reporting it as unpublished", async () => {
    // Both refuse; conflating them would tell an operator to wait for a
    // deploy when the real problem is a failing backend.
    respondError(500, "boom");
    const failure = await new HttpBridgeClient(BASE)
      .getRouteEligibility("SolToRhn", SOL_WALLET, GLC)
      .catch((error: unknown) => error);
    expect((failure as Error).name).not.toBe("EligibilityEndpointUnpublishedError");
    expect(isApiError(failure)).toBe(true);
  });

  it("refuses a 200 whose body does not match the schema", async () => {
    // A malformed clearance is not a clearance.
    respondOk({ route: "SolToRhn", eligible: true });
    await expect(
      new HttpBridgeClient(BASE).getRouteEligibility("SolToRhn", SOL_WALLET, GLC),
    ).rejects.toSatisfy((error: unknown) => isApiError(error));
  });

  it("refuses a 200 carrying the OLD expected shape, which no backend serves", async () => {
    // `source_eligibility`/`destination_eligibility` beside string echoes
    // was this client's guess at an endpoint that shipped differently.
    // Reading it would mean accepting a body the real service cannot
    // produce.
    respondOk({
      route: "SolToRhn",
      source: SOL_WALLET,
      destination: EVM_LOWER,
      eligible: true,
      source_eligibility: { eligible: true, applicable: true },
      destination_eligibility: { eligible: true, applicable: true },
      window_seconds: 86_400,
    });
    await expect(
      new HttpBridgeClient(BASE).getRouteEligibility("SolToRhn", SOL_WALLET, EVM_LOWER),
    ).rejects.toSatisfy((error: unknown) => isApiError(error));
  });

  it("refuses a route this build has no eligibility model for", async () => {
    respondOk({});
    await expect(
      new HttpBridgeClient(BASE).getRouteEligibility("NotARoute", SOL_WALLET, GLC),
    ).rejects.toMatchObject({ name: "EligibilityEndpointUnpublishedError" });
    // Nothing was even asked.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("never synthesises a clearance from a blocked per-leg answer", async () => {
    respondOk(
      routeBody(
        "SolToRhn",
        legBody(SOL_WALLET, {
          eligible: false,
          reason: "wallet_source_24h_limit",
          retry_after: 1_787_003_600,
          retry_after_seconds: 3_600,
        }),
        legBody(EVM_LOWER),
        false,
      ),
    );
    const answer = await new HttpBridgeClient(BASE).getRouteEligibility(
      "SolToRhn",
      SOL_WALLET,
      EVM_LOWER,
    );
    expect(answer.eligible).toBe(false);
    expect(answer.sourceSide).toMatchObject({
      eligible: false,
      applicable: true,
      reason: "wallet_source_24h_limit",
    });
  });
});

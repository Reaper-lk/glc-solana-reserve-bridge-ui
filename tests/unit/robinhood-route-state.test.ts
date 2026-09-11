import { describe, expect, it } from "vitest";
import {
  robinhoodReserveCapacity,
  robinhoodRouteGateState,
  robinhoodWindowRemaining,
} from "@/lib/bridge";
import type { RobinhoodRoute } from "@/lib/bridge";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { robinhoodReserveSchema } from "@/lib/api/schemas/robinhood";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";

/**
 * Robinhood route state, derived from `GET /robinhood/reserve`.
 *
 * The property every case below defends is the same one
 * `./direction-state` defends for the Solana pair: no figure and no
 * verdict is ever produced from a source that does not describe the route
 * it is shown against. A Robinhood route must never be answered with
 * Solana's rolling window, a route settling onto the Goldcoin or Solana
 * reserve must never be shown the Robinhood one's capacity, and an
 * unreadable contract must never read as "fine".
 *
 * All FOUR Robinhood-legged routes are covered, not the two that once were:
 * the contract bounds legs, and `SolToRhn`/`RhnToSol` sit on the same two
 * legs as `GlcToRhn`/`RhnToGlc`. Each case below asserts the leg pairing
 * rather than the route name, which is what keeps it honest if a fifth
 * route ever joins a leg.
 */

const now = () => new Date();

/** Always parsed, so a fixture that would fail the real boundary fails here. */
function reserve(
  options: Parameters<typeof fixtures.robinhoodReserveFixture>[1] = { open: true },
): RobinhoodReserveDto {
  return robinhoodReserveSchema.parse(fixtures.robinhoodReserveFixture(now, options));
}

/** The Goldcoin capacity `GET /reserve` publishes, as the view passes it in. */
const GOLDCOIN_CAPACITY = fixtures.reserveFixture().goldcoin_available_capacity;

/** The routes PAID OUT of the contract — bounded by the outbound window. */
const PAYOUT_ROUTES: readonly RobinhoodRoute[] = ["GlcToRhn", "SolToRhn"];
/** The routes DEPOSITED into it — bounded by the inbound window. */
const DEPOSIT_ROUTES: readonly RobinhoodRoute[] = ["RhnToGlc", "RhnToSol"];
const ALL_ROBINHOOD_ROUTES = [...PAYOUT_ROUTES, ...DEPOSIT_ROUTES];

/**
 * The gate for one route, composed exactly as the status page composes it:
 * the capacity of the reserve that PAYS the route, then the verdict.
 *
 * A payout leg reads the Robinhood ledger; a deposit leg settles elsewhere,
 * and the caller supplies that reserve's figure. Which is which is decided
 * here, in the test, rather than inside the module — that is the whole point
 * of the module no longer taking a route for its capacity read.
 */
function gate(
  route: RobinhoodRoute,
  dto: RobinhoodReserveDto | undefined,
  externalCapacity: string = GOLDCOIN_CAPACITY,
) {
  const capacity = PAYOUT_ROUTES.includes(route)
    ? (robinhoodReserveCapacity(dto)?.atomic ?? null)
    : externalCapacity;
  return robinhoodRouteGateState(route, dto, capacity);
}

describe("robinhoodReserveCapacity", () => {
  it("reports the Robinhood reserve in CANONICAL units", () => {
    // The backend keeps this reserve's books at 8 decimals because its
    // ledger column is an INTEGER and cannot hold Robinhood's 18. Reading
    // it at 18 would understate the capacity by ten orders of magnitude.
    expect(robinhoodReserveCapacity(reserve())).toEqual({
      atomic: "212000000000000",
      decimals: GOLDCOIN_DECIMALS,
    });
  });

  it("takes no route, so it cannot answer one with another's pool", () => {
    // The three pools are independent and one cannot cover another. This
    // function reads exactly one of them; which routes it answers for is
    // `CAPACITY` in `route-status`, stated once per route with no default.
    expect(robinhoodReserveCapacity(reserve())?.atomic).not.toBe(GOLDCOIN_CAPACITY);
  });

  it("reports an unconfigured Robinhood reserve as unknown, never as zero", () => {
    // "This reserve does not exist" and "this reserve is empty" are
    // different claims, and only one of them is true here.
    expect(robinhoodReserveCapacity(reserve({ open: false }))).toBeNull();
  });
});

describe("robinhoodWindowRemaining", () => {
  it.each(PAYOUT_ROUTES)(
    "charges %s against the OUTBOUND window, at 18 decimals",
    (route) => {
      // A payout leg pays out onto Robinhood, so the contract charges it to
      // the outbound window — and the contract accounts in its own 18
      // decimals, not the canonical 8 the capacity above uses.
      expect(robinhoodWindowRemaining(route, reserve())).toEqual({
        atomic: "61250000000000000000000",
        decimals: ROBINHOOD_DECIMALS,
      });
    },
  );

  it.each(DEPOSIT_ROUTES)("charges %s against the INBOUND window", (route) => {
    expect(robinhoodWindowRemaining(route, reserve())).toEqual({
      atomic: "100000000000000000000000",
      decimals: ROBINHOOD_DECIMALS,
    });
  });

  it("gives both routes on a leg the same figure, because the contract does", () => {
    // One inbound accumulator and one outbound accumulator, shared by every
    // route on that side. Reporting a per-route share of either would be a
    // limit the contract does not apply.
    const dto = reserve();
    expect(robinhoodWindowRemaining("GlcToRhn", dto)).toEqual(
      robinhoodWindowRemaining("SolToRhn", dto),
    );
    expect(robinhoodWindowRemaining("RhnToGlc", dto)).toEqual(
      robinhoodWindowRemaining("RhnToSol", dto),
    );
    // And the two LEGS are not the same figure, which is what proves the
    // equality above is not simply one value everywhere.
    expect(robinhoodWindowRemaining("GlcToRhn", dto)).not.toEqual(
      robinhoodWindowRemaining("RhnToGlc", dto),
    );
  });

  it.each(ALL_ROBINHOOD_ROUTES)(
    "reports an unread contract as unknown for %s, never as an exhausted window",
    (route) => {
      // "No headroom left" and "we could not ask" are opposite facts about
      // whether a transfer will go through.
      expect(robinhoodWindowRemaining(route, reserve({ open: false }))).toBeNull();
    },
  );
});

describe("robinhoodRouteGateState", () => {
  it.each(ALL_ROBINHOOD_ROUTES)(
    "is active for %s when the reserve, the contract and the indexer all report normally",
    (route) => {
      expect(gate(route, reserve())).toBe("active");
    },
  );

  it("fails closed to unknown before the endpoint has answered", () => {
    expect(gate("GlcToRhn", undefined)).toBe("unknown");
    expect(gate("RhnToSol", undefined)).toBe("unknown");
  });

  it.each(ALL_ROBINHOOD_ROUTES)(
    "reports a deployment with no Robinhood reserve as unknown for %s, not as available",
    (route) => {
      expect(gate(route, reserve({ open: false }))).toBe("unknown");
    },
  );

  it("closes a deposit leg when the reserve that PAYS it is paused", () => {
    // `RhnToGlc` settles onto Goldcoin and `RhnToSol` onto Solana, so the
    // Robinhood reserve's own pause is not the only one that can stop them.
    // A pause on the paying pool is passed in separately and is just as
    // hard a stop — the route cannot settle either way.
    const dto = reserve();
    expect(robinhoodRouteGateState("RhnToGlc", dto, GOLDCOIN_CAPACITY, true)).toBe(
      "operator-paused",
    );
    expect(robinhoodRouteGateState("RhnToSol", dto, GOLDCOIN_CAPACITY, true)).toBe(
      "operator-paused",
    );
    // Unread is not unpaused: a `null` leaves the remaining checks to
    // decide rather than declaring the route open on a missing value.
    expect(robinhoodRouteGateState("RhnToSol", dto, GOLDCOIN_CAPACITY, null)).toBe(
      "active",
    );
  });

  it("distinguishes the reserve's operator pause from the contract's kill switch", () => {
    expect(gate("GlcToRhn", reserve({ open: true, paused: true }))).toBe(
      "operator-paused",
    );
    expect(gate("GlcToRhn", reserve({ open: true, payoutsPaused: true }))).toBe(
      "contract-paused",
    );
  });

  it("applies each contract kill switch to its OWN leg only, across all four routes", () => {
    // `payoutsPaused` stops every route paid out onto Robinhood and says
    // nothing about a deposit; `depositsPaused` is the mirror image. A
    // paused payout leg is not a paused bridge — and it is not a paused
    // cross route either, which a route-name check would have got wrong.
    const payouts = reserve({ open: true, payoutsPaused: true });
    for (const route of PAYOUT_ROUTES) {
      expect(gate(route, payouts)).toBe("contract-paused");
    }
    for (const route of DEPOSIT_ROUTES) {
      expect(gate(route, payouts)).toBe("active");
    }

    const deposits = reserve({ open: true, depositsPaused: true });
    for (const route of DEPOSIT_ROUTES) {
      expect(gate(route, deposits)).toBe("contract-paused");
    }
    for (const route of PAYOUT_ROUTES) {
      expect(gate(route, deposits)).toBe("active");
    }
  });

  it("reports a halted indexer as degraded, not as paused or available", () => {
    // Nothing is blocked and no operator paused anything, but the figures
    // beside it may be behind the chain — so neither "Available" nor
    // "Paused" is true.
    expect(gate("GlcToRhn", reserve({ open: true, indexerHalted: true }))).toBe(
      "degraded",
    );
  });

  it("prefers a hard stop over a degraded read", () => {
    // A stalled indexer alongside an engaged pause is still a pause: the
    // pause is a stated fact, the staleness only casts doubt on figures.
    expect(
      gate("GlcToRhn", reserve({ open: true, paused: true, indexerHalted: true })),
    ).toBe("operator-paused");
  });

  it("reports zero destination capacity as constrained", () => {
    const dto = reserve();
    expect(
      robinhoodRouteGateState(
        "GlcToRhn",
        { ...dto, available_capacity_atomic: "0" },
        "0",
      ),
    ).toBe("capacity-constrained");
  });

  it("treats a negative capacity as constrained rather than as headroom", () => {
    // The backend reports a below-zero capacity as a real diagnostic state
    // rather than clamping it. It is not spare capacity.
    const dto = reserve();
    expect(
      robinhoodRouteGateState(
        "GlcToRhn",
        { ...dto, available_capacity_atomic: "-500" },
        "-500",
      ),
    ).toBe("capacity-constrained");
  });

  it("reports a spent rolling window as quota-exhausted", () => {
    const dto = reserve();
    const spent: RobinhoodReserveDto = {
      ...dto,
      onchain: {
        ...dto.onchain,
        outbound_window: { ...dto.onchain.outbound_window!, remaining_atomic: "0" },
      },
    };
    for (const route of PAYOUT_ROUTES) {
      expect(gate(route, spent)).toBe("quota-exhausted");
    }
    // The inbound window is untouched, so the other leg is unaffected —
    // both routes on it.
    for (const route of DEPOSIT_ROUTES) {
      expect(gate(route, spent)).toBe("active");
    }
  });

  it("degrades rather than guessing when the contract could not be read", () => {
    const dto = reserve();
    const unread: RobinhoodReserveDto = {
      ...dto,
      onchain: {
        availability: "unavailable",
        encumbered_reserve_atomic: null,
        protected_min_reserve_atomic: null,
        deposits_paused: null,
        payouts_paused: null,
        inbound_window: null,
        outbound_window: null,
        window_seconds: null,
      },
    };
    expect(gate("GlcToRhn", unread)).toBe("degraded");
    expect(robinhoodWindowRemaining("GlcToRhn", unread)).toBeNull();
  });

  it("fails closed on an availability spelling this build has never seen", () => {
    // A fourth constant added backend-side must degrade to "not
    // available", never be read as one.
    const dto = reserve();
    expect(gate("GlcToRhn", { ...dto, ledger_availability: "some_future_state" })).toBe(
      "unknown",
    );
  });
});

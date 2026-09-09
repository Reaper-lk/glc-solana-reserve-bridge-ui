import { describe, expect, it } from "vitest";
import {
  robinhoodDestinationCapacity,
  robinhoodRouteGateState,
  robinhoodWindowRemaining,
} from "@/lib/bridge";
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
 * Solana's rolling window, `RhnToGlc` must never be shown the Robinhood
 * reserve's capacity when it settles onto the Goldcoin one, and an
 * unreadable contract must never read as "fine".
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

function gate(
  route: "GlcToRhn" | "RhnToGlc",
  dto: RobinhoodReserveDto | undefined,
  goldcoinCapacity: string = GOLDCOIN_CAPACITY,
) {
  const capacity = robinhoodDestinationCapacity(route, dto, goldcoinCapacity);
  return robinhoodRouteGateState(route, dto, capacity?.atomic ?? null);
}

describe("robinhoodDestinationCapacity", () => {
  it("pays GlcToRhn out of the Robinhood reserve, in CANONICAL units", () => {
    // The backend keeps this reserve's books at 8 decimals because its
    // ledger column is an INTEGER and cannot hold Robinhood's 18. Reading
    // it at 18 would understate the capacity by ten orders of magnitude.
    expect(
      robinhoodDestinationCapacity("GlcToRhn", reserve(), GOLDCOIN_CAPACITY),
    ).toEqual({ atomic: "212000000000000", decimals: GOLDCOIN_DECIMALS });
  });

  it("pays RhnToGlc out of the GOLDCOIN reserve, not the Robinhood one", () => {
    // The three pools are independent and one cannot cover another.
    expect(
      robinhoodDestinationCapacity("RhnToGlc", reserve(), GOLDCOIN_CAPACITY),
    ).toEqual({ atomic: GOLDCOIN_CAPACITY, decimals: GOLDCOIN_DECIMALS });
  });

  it("reports an unconfigured Robinhood reserve as unknown, never as zero", () => {
    // "This reserve does not exist" and "this reserve is empty" are
    // different claims, and only one of them is true here.
    expect(
      robinhoodDestinationCapacity(
        "GlcToRhn",
        reserve({ open: false }),
        GOLDCOIN_CAPACITY,
      ),
    ).toBeNull();
  });
});

describe("robinhoodWindowRemaining", () => {
  it("charges GlcToRhn against the OUTBOUND window, at 18 decimals", () => {
    // GlcToRhn pays out onto Robinhood, so the contract charges it to the
    // payout window — and the contract accounts in its own 18 decimals,
    // not the canonical 8 the capacity above uses.
    expect(robinhoodWindowRemaining("GlcToRhn", reserve())).toEqual({
      atomic: "61250000000000000000000",
      decimals: ROBINHOOD_DECIMALS,
    });
  });

  it("charges RhnToGlc against the INBOUND window", () => {
    expect(robinhoodWindowRemaining("RhnToGlc", reserve())).toEqual({
      atomic: "100000000000000000000000",
      decimals: ROBINHOOD_DECIMALS,
    });
  });

  it("reports an unread contract as unknown, never as an exhausted window", () => {
    // "No headroom left" and "we could not ask" are opposite facts about
    // whether a transfer will go through.
    expect(robinhoodWindowRemaining("GlcToRhn", reserve({ open: false }))).toBeNull();
  });
});

describe("robinhoodRouteGateState", () => {
  it("is active when the reserve, the contract and the indexer all report normally", () => {
    expect(gate("GlcToRhn", reserve())).toBe("active");
    expect(gate("RhnToGlc", reserve())).toBe("active");
  });

  it("fails closed to unknown before the endpoint has answered", () => {
    expect(gate("GlcToRhn", undefined)).toBe("unknown");
  });

  it("reports a deployment with no Robinhood reserve as unknown, not as available", () => {
    expect(gate("GlcToRhn", reserve({ open: false }))).toBe("unknown");
    expect(gate("RhnToGlc", reserve({ open: false }))).toBe("unknown");
  });

  it("distinguishes the reserve's operator pause from the contract's kill switch", () => {
    expect(gate("GlcToRhn", reserve({ open: true, paused: true }))).toBe(
      "operator-paused",
    );
    expect(gate("GlcToRhn", reserve({ open: true, payoutsPaused: true }))).toBe(
      "contract-paused",
    );
  });

  it("applies each contract kill switch to its OWN leg only", () => {
    // `payoutsPaused` stops GlcToRhn (a payout onto Robinhood) and says
    // nothing about a deposit; `depositsPaused` is the mirror image. A
    // paused payout leg is not a paused bridge.
    const payouts = reserve({ open: true, payoutsPaused: true });
    expect(gate("GlcToRhn", payouts)).toBe("contract-paused");
    expect(gate("RhnToGlc", payouts)).toBe("active");

    const deposits = reserve({ open: true, depositsPaused: true });
    expect(gate("RhnToGlc", deposits)).toBe("contract-paused");
    expect(gate("GlcToRhn", deposits)).toBe("active");
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
    expect(gate("GlcToRhn", spent)).toBe("quota-exhausted");
    // The inbound window is untouched, so the other leg is unaffected.
    expect(gate("RhnToGlc", spent)).toBe("active");
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

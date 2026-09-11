import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { ReservesView } from "@/features/reserves/ReservesView";
import { bridgeStatsSchema, robinhoodReserveLedger } from "@/lib/api/schemas/stats";
import { reserveHistoryListSchema } from "@/lib/api/schemas/reserves";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The Robinhood reserve on `GET /stats`, backend PR #79.
 *
 * Two independent defects are pinned here, because the page showed them
 * together and only one of them is about `robinhood_reserve`:
 *
 * 1. `bridgeStatsSchema` had no `robinhood_reserve` member, so Zod — which
 *    STRIPS unknown keys rather than rejecting them — silently dropped the
 *    whole thing. Nothing errored; the reserve simply never reached the
 *    view, which is why the page rendered two cards and no third.
 * 2. `reserveHistoryEntrySchema.direction` was a CLOSED enum over
 *    `"GoldcoinReserve" | "SolanaReserve"`. A bridge reconciling a third
 *    reserve puts `"RobinhoodReserve"` rows in `GET /reserves/history`,
 *    and one such row failed the whole response — which is the red
 *    "The bridge returned data this page could not read." banner, since
 *    the reconciliation table is the only part of /reserves that errors
 *    BELOW the reserve cards instead of replacing them.
 */

/**
 * The exact production body, verbatim. Kept in the test rather than in the
 * mock fixtures, which are documented to carry obviously-non-production
 * numbers only.
 */
const PRODUCTION_ROBINHOOD_RESERVE = {
  ledger_availability: "available",
  paused: true,
  available_capacity: "153971500000000",
  settled_volume_atomic: "48500000000",
  accrued_fees_atomic: "2880600000000",
} as const;

/** What the backend sends when there is no `[reserve.robinhood]` section. */
const NOT_CONFIGURED_ROBINHOOD_RESERVE = {
  ledger_availability: "not_configured",
  paused: null,
  available_capacity: null,
  settled_volume_atomic: null,
  accrued_fees_atomic: null,
} as const;

const productionStats = () => ({
  ...fixtures.statsFixture(),
  robinhood_reserve: { ...PRODUCTION_ROBINHOOD_RESERVE },
});

const getReserve = vi.fn();
const getStats = vi.fn();
const getChains = vi.fn();
const listReserveHistory = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getReserve: (...args: unknown[]) => getReserve(...args),
    getStats: (...args: unknown[]) => getStats(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    listReserveHistory: (...args: unknown[]) => listReserveHistory(...args),
  },
}));

const now = () => new Date();

beforeEach(() => {
  vi.resetAllMocks();
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getChains.mockResolvedValue(fixtures.chainsFixture(now, { robinhoodOpen: true }));
  listReserveHistory.mockResolvedValue({
    items: fixtures.reserveHistoryFixture(),
    next_cursor: null,
    as_of: 0,
  });
});

describe("GET /stats robinhood_reserve — schema", () => {
  it("parses the production payload instead of dropping it", () => {
    const parsed = bridgeStatsSchema.safeParse(productionStats());

    expect(parsed.success).toBe(true);
    // The regression itself: before the member existed, this key was
    // silently stripped and every assertion below was vacuously "absent".
    expect(parsed.success && parsed.data.robinhood_reserve).toEqual(
      PRODUCTION_ROBINHOOD_RESERVE,
    );
  });

  it("parses the not-configured payload without turning any null into a zero", () => {
    const parsed = bridgeStatsSchema.safeParse({
      ...fixtures.statsFixture(),
      robinhood_reserve: { ...NOT_CONFIGURED_ROBINHOOD_RESERVE },
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.robinhood_reserve).toEqual(
      NOT_CONFIGURED_ROBINHOOD_RESERVE,
    );
    // `robinhoodReserveLedger` is the one place that decides whether the
    // figures are real. It must refuse, not substitute.
    expect(
      parsed.success ? robinhoodReserveLedger(parsed.data) : "did not parse",
    ).toBeNull();
  });

  it("still parses a backend that predates the member entirely", () => {
    // Optional and deliberately not defaulted: an absent member is a
    // different fact from a `not_configured` one.
    const { robinhood_reserve: _absent, ...withoutMember } = productionStats();
    const parsed = bridgeStatsSchema.safeParse(withoutMember);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.robinhood_reserve).toBeUndefined();
    expect(parsed.success && robinhoodReserveLedger(parsed.data)).toBeNull();
  });

  it("refuses a ledger_availability this build does not know, fail-closed", () => {
    // Parses — a fourth backend spelling must never take the page down —
    // but yields no figures, exactly as `isRobinhoodAvailable` promises.
    const parsed = bridgeStatsSchema.parse({
      ...fixtures.statsFixture(),
      robinhood_reserve: {
        ...PRODUCTION_ROBINHOOD_RESERVE,
        ledger_availability: "draining",
      },
    });

    expect(parsed.robinhood_reserve?.ledger_availability).toBe("draining");
    expect(robinhoodReserveLedger(parsed)).toBeNull();
  });

  it("keeps the amounts strictly validated even though the verdict is permissive", () => {
    const parsed = bridgeStatsSchema.safeParse({
      ...fixtures.statsFixture(),
      robinhood_reserve: {
        ...PRODUCTION_ROBINHOOD_RESERVE,
        // Past Number.MAX_SAFE_INTEGER: already corrupted by JSON.parse.
        settled_volume_atomic: 9408405829927559,
      },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("Reserves page — the Robinhood card", () => {
  it("renders a third reserve card from the production payload", async () => {
    getStats.mockResolvedValue(productionStats());
    renderWithQueryClient(<ReservesView />);

    expect(
      await screen.findByRole("heading", { name: "Robinhood reserve" }),
    ).toBeInTheDocument();
  });

  it("shows the capacity at the canonical 8 decimals, and the paused state", async () => {
    getStats.mockResolvedValue(productionStats());
    renderWithQueryClient(<ReservesView />);

    // 153971500000000 at 8dp is 1,539,715.00 GLC. At the custody
    // contract's native 18 it would be 0.00015..., and at Solana's 6 it
    // would be 153,971,500.00 — both wrong by orders of magnitude.
    expect(await screen.findByText(/1,539,715\.00/)).toBeInTheDocument();
    // `paused: true` in the production body, so the badge says so rather
    // than reporting the capacity beside it as spendable.
    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("keeps the settled and accrued figures the backend published", async () => {
    getStats.mockResolvedValue(productionStats());
    renderWithQueryClient(<ReservesView />);

    // 48500000000 -> 485.00 and 2880600000000 -> 28,806.00, both at 8dp.
    expect(await screen.findByText(/485\.00/)).toBeInTheDocument();
    expect(await screen.findByText(/28,806\.00/)).toBeInTheDocument();
  });

  it("renders an unavailable state for not_configured, never a zero", async () => {
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      robinhood_reserve: { ...NOT_CONFIGURED_ROBINHOOD_RESERVE },
    });
    renderWithQueryClient(<ReservesView />);

    const card = (
      await screen.findByRole("heading", { name: "Robinhood reserve" })
    ).closest("div[class]")!.parentElement!;

    expect(card.textContent).toMatch(/Not configured on this deployment/i);
    expect(card.textContent).toMatch(/no capacity to report/i);
    // The defect this test exists for: no "0.00 GLC", and no "Available".
    expect(card.textContent).not.toMatch(/0\.00/);
    expect(card.textContent).toMatch(/Unknown/);
  });

  it("renders an unavailable state for a configured reserve that could not be read", async () => {
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      robinhood_reserve: {
        ...NOT_CONFIGURED_ROBINHOOD_RESERVE,
        ledger_availability: "unavailable",
      },
    });
    renderWithQueryClient(<ReservesView />);

    expect(
      await screen.findByText(/could not read this reserve just now/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a balance of zero/i)).toBeInTheDocument();
  });

  it("shows no card at all when the backend does not publish the member", async () => {
    const { robinhood_reserve: _absent, ...withoutMember } = productionStats();
    getStats.mockResolvedValue(withoutMember);
    renderWithQueryClient(<ReservesView />);

    await screen.findByRole("heading", { name: "Solana reserve" });
    expect(screen.queryByRole("heading", { name: "Robinhood reserve" })).toBeNull();
  });

  it("leaves the Solana and Goldcoin cards exactly as they were", async () => {
    getStats.mockResolvedValue(productionStats());
    renderWithQueryClient(<ReservesView />);

    expect(
      await screen.findByRole("heading", { name: "Solana reserve" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Goldcoin reserve" })).toBeInTheDocument();
    // reserveFixture: 398000000000000 on Solana at the mint's 6dp is
    // 398,000,000.00, and 425000000000000 on Goldcoin at 8dp is
    // 4,250,000.00. Neither is re-denominated by the third card's arrival,
    // and neither borrows the Robinhood reserve's figures.
    expect(screen.getByText(/398,000,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/4,250,000\.00/)).toBeInTheDocument();
    expect(screen.getAllByText("Available")).toHaveLength(2);
  });

  it("never shows the red parse banner for valid Robinhood data", async () => {
    getStats.mockResolvedValue(productionStats());
    renderWithQueryClient(<ReservesView />);

    await screen.findByRole("heading", { name: "Robinhood reserve" });
    expect(
      screen.queryByText("The bridge returned data this page could not read."),
    ).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("GET /reserves/history with a third reserve", () => {
  it("parses a RobinhoodReserve reconciliation row instead of failing the page", () => {
    // The closed enum this replaced rejected the whole response, which is
    // what put the red banner under the two reserve cards.
    const parsed = reserveHistoryListSchema.safeParse({
      items: [
        {
          id: 1,
          direction: "RobinhoodReserve",
          detected_at: 0,
          expected_atomic: "100",
          observed_atomic: "100",
          delta_atomic: "0",
          classification: "WITHIN_TOLERANCE",
          auto_paused: false,
        },
      ],
      next_cursor: null,
      as_of: 0,
    });

    expect(parsed.success).toBe(true);
  });

  it("labels a Robinhood row as Robinhood, not as Solana", async () => {
    getStats.mockResolvedValue(productionStats());
    listReserveHistory.mockResolvedValue({
      items: [
        {
          id: 1,
          direction: "RobinhoodReserve",
          detected_at: 0,
          expected_atomic: "100",
          observed_atomic: "100",
          delta_atomic: "0",
          classification: "WITHIN_TOLERANCE",
          auto_paused: false,
        },
      ],
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ReservesView />);

    // The ternary this replaced had no third branch: every non-Goldcoin
    // row was labelled "Solana", so a Robinhood discrepancy would have
    // been attributed to the wrong reserve.
    expect(await screen.findByRole("cell", { name: "Robinhood" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Solana" })).toBeNull();
  });

  it("renders a reserve spelling this build has never heard of verbatim", async () => {
    getStats.mockResolvedValue(productionStats());
    listReserveHistory.mockResolvedValue({
      items: [
        {
          id: 1,
          direction: "AvalancheReserve",
          detected_at: 0,
          expected_atomic: "100",
          observed_atomic: "100",
          delta_atomic: "0",
          classification: "WITHIN_TOLERANCE",
          auto_paused: false,
        },
      ],
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ReservesView />);

    expect(
      await screen.findByRole("cell", { name: "AvalancheReserve" }),
    ).toBeInTheDocument();
  });
});

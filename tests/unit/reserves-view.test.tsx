import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { ReservesView } from "@/features/reserves/ReservesView";
import * as fixtures from "@/lib/api/mock/fixtures";

const getReserve = vi.fn();
const getStats = vi.fn();
const listReserveHistory = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getReserve: (...args: unknown[]) => getReserve(...args),
    getStats: (...args: unknown[]) => getStats(...args),
    listReserveHistory: (...args: unknown[]) => listReserveHistory(...args),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  listReserveHistory.mockResolvedValue({
    items: fixtures.reserveHistoryFixture(),
    next_cursor: null,
    as_of: 0,
  });
});

describe("ReservesView", () => {
  it("shows both reserves as available when capacity is positive and unpaused", async () => {
    getReserve.mockResolvedValue(fixtures.reserveFixture());
    getStats.mockResolvedValue(fixtures.statsFixture());
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findAllByText("Available")).toHaveLength(2);
  });

  it("flags insufficient liquidity when a reserve's capacity is exhausted", async () => {
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: 4_250_000_00000000,
      solana_available_capacity: 0,
    });
    getStats.mockResolvedValue(fixtures.statsFixture());
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText("Insufficient liquidity")).toBeInTheDocument();
  });

  it("shows Paused for a reserve the backend reports as paused, even with capacity", async () => {
    getReserve.mockResolvedValue(fixtures.reserveFixture());
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      solana_paused: true,
    });
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText("Paused")).toBeInTheDocument();
  });

  it("flags a negative reported capacity as needing operator attention rather than hiding it", async () => {
    getReserve.mockResolvedValue({
      goldcoin_available_capacity: -5_00000000,
      solana_available_capacity: 100_00000000,
    });
    getStats.mockResolvedValue(fixtures.statsFixture());
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText(/needs operator attention/i)).toBeInTheDocument();
  });

  it("surfaces an API failure instead of a blank reserves page", async () => {
    getReserve.mockRejectedValue(new Error("down"));
    getStats.mockResolvedValue(fixtures.statsFixture());
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("flags a skipped reconciliation tick as a missing data point, not a zero", async () => {
    getReserve.mockResolvedValue(fixtures.reserveFixture());
    getStats.mockResolvedValue(fixtures.statsFixture());
    listReserveHistory.mockResolvedValue({
      items: [
        {
          id: 1,
          direction: "SolanaReserve",
          detected_at: 0,
          expected_atomic: 100,
          observed_atomic: 100,
          delta_atomic: 0,
          classification: "SKIPPED: rpc unavailable",
          auto_paused: false,
        },
      ],
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText(/missing tick/i)).toBeInTheDocument();
  });

  it("renders the backend's IN_FLIGHT_EXPLAINED classification humanized, as a normal tick", async () => {
    // Newly reachable on the wire: the backend's reconciliation now
    // classifies a drop covered by its own broadcast-but-unfolded
    // settlements as IN_FLIGHT_EXPLAINED instead of spuriously breaching.
    // It is a routine, healthy observation — rendered readably, never as
    // a missing tick and never as raw enum text.
    getReserve.mockResolvedValue(fixtures.reserveFixture());
    getStats.mockResolvedValue(fixtures.statsFixture());
    listReserveHistory.mockResolvedValue({
      items: [
        {
          id: 1,
          direction: "SolanaReserve",
          detected_at: 0,
          expected_atomic: 100,
          observed_atomic: 60,
          delta_atomic: -40,
          classification: "IN_FLIGHT_EXPLAINED",
          auto_paused: false,
        },
      ],
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText("In flight explained")).toBeInTheDocument();
    expect(screen.queryByText(/missing tick/i)).not.toBeInTheDocument();
    expect(screen.queryByText("IN_FLIGHT_EXPLAINED")).not.toBeInTheDocument();
  });

  it("shows a real empty state for reconciliation history rather than silently rendering nothing", async () => {
    getReserve.mockResolvedValue(fixtures.reserveFixture());
    getStats.mockResolvedValue(fixtures.statsFixture());
    listReserveHistory.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });
    renderWithQueryClient(<ReservesView />);

    expect(await screen.findByText(/No reconciliation ticks yet/i)).toBeInTheDocument();
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";

/**
 * The route/capacity cards at the top of /status, once Robinhood is live.
 *
 * The cards used to be two hardcoded blocks reading `GET /status` and
 * `GET /reserve` — endpoints whose every field is named for `GlcToSol` or
 * `SolToGlc`. A Robinhood route has no field on either, so the failure
 * mode this file guards is not a missing card: it is a Robinhood card
 * filled with Solana's rolling window and Solana's reserve capacity, which
 * would read as authoritative and be wrong.
 *
 * The Robinhood figures come from `GET /robinhood/reserve` instead: a
 * third reserve ledger in CANONICAL 8-decimal units, and a custody
 * contract whose rolling windows are in Robinhood's native 18. Both appear
 * on the same card, which is exactly why the units are pinned here.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();
const getRobinhoodReserve = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getRobinhoodReserve: (...args: unknown[]) => getRobinhoodReserve(...args),
  },
}));

const now = () => new Date();

/** `/chains` with both Robinhood routes open — the launched state. */
const openChains = (): ChainsViewDto =>
  fixtures.chainsFixture(now, { robinhoodOpen: true });

const openReserve = (
  options: Parameters<typeof fixtures.robinhoodReserveFixture>[1] = { open: true },
): RobinhoodReserveDto => fixtures.robinhoodReserveFixture(now, options);

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(now));
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getChains.mockResolvedValue(openChains());
  getRobinhoodReserve.mockResolvedValue(openReserve());
});

/**
 * One route card. Each is a group labelled by its own heading, which is
 * what lets a reader — and this test — tell four cards repeating the same
 * two terms apart.
 */
async function card(title: string) {
  return within(await screen.findByRole("group", { name: title }));
}

describe("StatusView with Robinhood routes open", () => {
  it("gives each live Robinhood route its own card", async () => {
    renderWithQueryClient(<StatusView />);

    expect(
      await screen.findByRole("heading", { name: "GLC L1 → GLC on Robinhood" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "GLC on Robinhood → GLC L1" }),
    ).toBeInTheDocument();
  });

  it("never gives SolToRhn or RhnToSol a card", async () => {
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "GLC L1 → GLC on Robinhood" });

    // Neither has settlement machinery, so neither can have capacity or a
    // window. They appear in the Routes list below as "Not implemented".
    expect(
      screen.queryByRole("heading", { name: "GLC on Solana → GLC on Robinhood" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "GLC on Robinhood → GLC on Solana" }),
    ).toBeNull();
  });

  it("shows availability, destination capacity and 24h headroom on a live route", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");

    // The card renders before `/robinhood/reserve` answers, and until it
    // does the route reads as unknown — fail closed. Awaited, so what is
    // asserted below is the settled state and not the placeholder.
    expect(await glcToRhn.findByText("Available")).toBeInTheDocument();
    // Capacity: the Robinhood reserve's own, at CANONICAL 8 decimals —
    // 212000000000000 base units is 2,120,000 GLC.
    expect(glcToRhn.getByText(/2,120,000\.00/)).toBeInTheDocument();
    expect(glcToRhn.getByText("Destination reserve capacity")).toBeInTheDocument();
    // Window: the contract's outbound bucket, at ROBINHOOD's 18 decimals —
    // 61250000000000000000000 base units is 61,250 GLC. Read at 8 it would
    // print as 612,500,000,000,000.
    expect(glcToRhn.getByText(/61,250\.00/)).toBeInTheDocument();
  });

  it("pays RhnToGlc out of the GOLDCOIN reserve, not the Robinhood one", async () => {
    renderWithQueryClient(<StatusView />);
    const rhnToGlc = await card("GLC on Robinhood → GLC L1");

    // reserveFixture's goldcoin capacity: 425000000000000 at 8dp.
    expect(await rhnToGlc.findByText(/4,250,000\.00/)).toBeInTheDocument();
    // And its inbound window, at 18dp: 100,000 GLC.
    expect(rhnToGlc.getByText(/100,000\.00/)).toBeInTheDocument();
  });

  it("charges each route against its own contract window", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");
    const rhnToGlc = await card("GLC on Robinhood → GLC L1");
    await glcToRhn.findByText(/61,250\.00/);

    // The outbound bucket is partly spent and the inbound one is not.
    // Crossing them would report a limit the contract does not apply here.
    expect(glcToRhn.queryByText(/100,000\.00/)).toBeNull();
    expect(rhnToGlc.queryByText(/61,250\.00/)).toBeNull();
  });

  it("reports the reserve's operator pause", async () => {
    getRobinhoodReserve.mockResolvedValue(openReserve({ open: true, paused: true }));
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");

    expect(await glcToRhn.findByText("Paused")).toBeInTheDocument();
  });

  it("names the custody contract when the pause is the contract's, not the bridge's", async () => {
    getRobinhoodReserve.mockResolvedValue(
      openReserve({ open: true, payoutsPaused: true }),
    );
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");

    expect(await glcToRhn.findByText("Paused")).toBeInTheDocument();
    expect(
      glcToRhn.getByText(/Paused on the Robinhood custody contract itself/),
    ).toBeInTheDocument();
    // The kill switch is per leg: the deposit direction is unaffected.
    const rhnToGlc = await card("GLC on Robinhood → GLC L1");
    expect(rhnToGlc.getByText("Available")).toBeInTheDocument();
  });

  it("reports a stalled indexer as degraded rather than available", async () => {
    getRobinhoodReserve.mockResolvedValue(
      openReserve({ open: true, indexerHalted: true }),
    );
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");

    expect(await glcToRhn.findByText("Degraded")).toBeInTheDocument();
    expect(glcToRhn.queryByText("Available")).toBeNull();
  });

  it("says a figure is not published rather than showing it as zero", async () => {
    // A route reported open by `/chains` on a deployment with no
    // `[reserve.robinhood]` section. "0 GLC of capacity" would claim an
    // empty reserve; there is no reserve.
    getRobinhoodReserve.mockResolvedValue(openReserve({ open: false }));
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");
    // An unanswered read and an unconfigured reserve fail closed to the
    // SAME display, which is the point — so wait for the read to land
    // before asserting, or the test would pass on the placeholder.
    await vi.waitFor(() => expect(getRobinhoodReserve).toHaveBeenCalled());

    expect(await glcToRhn.findByText("Unknown")).toBeInTheDocument();
    expect(glcToRhn.getAllByText("Not published")).toHaveLength(2);
    expect(glcToRhn.queryByText(/0\.00 GLC/)).toBeNull();
  });

  it("fails closed when /robinhood/reserve cannot be read at all", async () => {
    getRobinhoodReserve.mockRejectedValue(new Error("404"));
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GLC L1 → GLC on Robinhood");
    await vi.waitFor(() => expect(getRobinhoodReserve).toHaveBeenCalled());

    expect(await glcToRhn.findByText("Unknown")).toBeInTheDocument();
    // And the page as a whole still renders — a missing Robinhood endpoint
    // is a deployment fact, not a reason to take /status down.
    expect(screen.getByText("System health")).toBeInTheDocument();
  });

  it("leaves the two Solana cards exactly as they were", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToSol = await card("GLC L1 → GLC on Solana");

    expect(glcToSol.getByText("Available")).toBeInTheDocument();
    // solana_available_capacity 398000000000000 at the mint's 6 decimals.
    expect(glcToSol.getByText(/398,000,000\.00/)).toBeInTheDocument();
    // glc_to_sol_rolling_volume_remaining 17500000000, also mint-atomic.
    expect(glcToSol.getByText(/17,500\.00/)).toBeInTheDocument();
  });
});

describe("StatusView with Robinhood routes closed", () => {
  beforeEach(() => {
    getChains.mockResolvedValue(fixtures.chainsFixture(now));
  });

  it("shows only the two Solana cards", async () => {
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "GLC L1 → GLC on Solana" });

    // The Routes card below already lists both Robinhood routes as
    // unavailable, with the backend's own reason. A second, emptier card
    // saying the same thing is noise; one full of zeroes would be worse.
    expect(screen.getAllByText("Destination reserve capacity")).toHaveLength(2);
    expect(
      screen.queryByRole("heading", { name: "GLC L1 → GLC on Robinhood", level: 2 }),
    ).toBeNull();
  });

  it("does not ask for the Robinhood reserve at all", async () => {
    // `/chains` is the availability authority, and a deployment predating
    // these endpoints answers 404 — a request per poll tick for a route
    // nobody can use.
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "Routes" });

    expect(getRobinhoodReserve).not.toHaveBeenCalled();
  });
});

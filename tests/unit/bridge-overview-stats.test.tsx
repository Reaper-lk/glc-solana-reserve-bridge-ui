import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The explorer's aggregate summary.
 *
 * It used to name `GlcToSol`/`SolToGlc` in the markup and read
 * `solana_reserve`/`goldcoin_reserve` straight off `GET /stats`. That
 * mapping is only correct while those two are the only routes with
 * settlement machinery — `RhnToGlc` settles onto the SAME Goldcoin
 * reserve, and `settled_volume_atomic` is a per-reserve counter, so the
 * card labelled "Solana → Goldcoin settled" would have started including
 * Robinhood volume the day that route opened, with no visible change.
 *
 * These tests pin the replacement: families read from `GET /chains`,
 * grouped by the reserve that pays them, with every family feeding a
 * shared counter named on it.
 */

const getStats = vi.fn();
const getChains = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStats: (...args: unknown[]) => getStats(...args),
    getChains: (...args: unknown[]) => getChains(...args),
  },
}));

const now = () => new Date();

beforeEach(() => {
  vi.resetAllMocks();
  getStats.mockResolvedValue(fixtures.statsFixture());
  getChains.mockResolvedValue(fixtures.chainsFixture(now));
});

/** The heading of every summary card, in render order. */
async function cardLabels(): Promise<string[]> {
  await screen.findAllByText(/Settled into/);
  // The label and its scope line are separate block spans inside the `dt`,
  // so `textContent` would run them together. Joined explicitly instead.
  return screen.getAllByRole("term").map((term) =>
    [...term.children]
      .map((child) => child.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" — "),
  );
}

describe("BridgeOverviewStats", () => {
  it("names all four executable route families", async () => {
    renderWithQueryClient(<BridgeOverviewStats />);
    const labels = (await cardLabels()).join(" | ");

    expect(labels).toContain("GLC L1 → GLC on Solana");
    expect(labels).toContain("GLC on Solana → GLC L1");
    expect(labels).toContain("GLC L1 → GLC on Robinhood");
    expect(labels).toContain("GLC on Robinhood → GLC L1");
  });

  it("never presents SolToRhn or RhnToSol as executable", async () => {
    renderWithQueryClient(<BridgeOverviewStats />);
    const labels = (await cardLabels()).join(" | ");

    // Neither has a `Direction` value on either side, so no settlement
    // function can be called with them and no volume can ever accrue.
    expect(labels).not.toContain("GLC on Solana → GLC on Robinhood");
    expect(labels).not.toContain("GLC on Robinhood → GLC on Solana");
  });

  it("groups by the reserve that pays out, not by route", async () => {
    renderWithQueryClient(<BridgeOverviewStats />);
    const labels = await cardLabels();

    expect(labels.filter((label) => label.startsWith("Settled into"))).toEqual([
      "Settled into Solana — GLC L1 → GLC on Solana",
      "Settled into Goldcoin — GLC on Solana → GLC L1 · GLC on Robinhood → GLC L1",
      "Settled into Robinhood Chain — GLC L1 → GLC on Robinhood",
    ]);
  });

  it("shows the shared Goldcoin counter once, never once per family", async () => {
    // `SolToGlc` and `RhnToGlc` both settle onto the Goldcoin reserve and
    // share one `settled_volume_atomic`. Rendering it against both would
    // double the bridge's apparent Goldcoin-side volume.
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      goldcoin_reserve: {
        ...fixtures.statsFixture().goldcoin_reserve,
        settled_volume_atomic: "1234500000000",
      },
    });
    renderWithQueryClient(<BridgeOverviewStats />);

    expect(await screen.findAllByText(/12,345\.00/)).toHaveLength(1);
  });

  it("renders each reserve's volume at ITS OWN decimals", async () => {
    // The Goldcoin reserve settles in 8-decimal units and the Solana one
    // in the mint's 6. Formatting either with the other's decimals is
    // wrong by two orders of magnitude.
    getStats.mockResolvedValue({
      ...fixtures.statsFixture(),
      goldcoin_reserve: {
        ...fixtures.statsFixture().goldcoin_reserve,
        settled_volume_atomic: "500000000000",
      },
      solana_reserve: {
        ...fixtures.statsFixture().solana_reserve,
        settled_volume_atomic: "5000000000",
      },
    });
    renderWithQueryClient(<BridgeOverviewStats />);

    // Both are 5,000 GLC — at 8dp and 6dp respectively.
    expect(await screen.findAllByText(/5,000\.00/)).toHaveLength(2);
  });

  it("says the Robinhood reserve's settled volume is not published", async () => {
    // No DTO carries it: `GET /stats` has no `robinhood_reserve` member,
    // and `GET /robinhood/reserve` publishes capacity and fees but no
    // cumulative settled-volume counter. A zero here would be invented.
    renderWithQueryClient(<BridgeOverviewStats />);
    expect(await screen.findByText("Not published")).toBeInTheDocument();
  });

  it("states which families the request counters actually cover", async () => {
    // `BridgeStats` carries exactly two `DirectionStats` members. A
    // Robinhood transfer is counted in neither, so the card may not imply
    // it covers the bridge.
    renderWithQueryClient(<BridgeOverviewStats />);
    const scope = await screen.findAllByText(
      "Counted for GLC L1 → GLC on Solana, GLC on Solana → GLC L1 only",
    );
    expect(scope).toHaveLength(2);
  });

  it("sums the counters only over the directions /stats reports", async () => {
    renderWithQueryClient(<BridgeOverviewStats />);
    // 6 + 4 in-flight, 2 + 1 in manual review, from the fixture.
    expect(await screen.findByText("10")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("drops the scope line once every executable family is counted", async () => {
    // A backend that stopped implementing the Robinhood routes would leave
    // nothing uncounted — and the caveat would then be noise, not honesty.
    const base = fixtures.chainsFixture(now);
    getChains.mockResolvedValue({
      ...base,
      routes: base.routes.map((route) =>
        route.id === "GlcToRhn" || route.id === "RhnToGlc"
          ? { ...route, implemented: false }
          : route,
      ),
    });
    renderWithQueryClient(<BridgeOverviewStats />);

    await screen.findAllByText(/Settled into/);
    expect(screen.queryByText(/Counted for/)).toBeNull();
  });

  it("renders the counters even when the route registry could not be read", async () => {
    // Settled volume needs the families and is withheld without them —
    // never replaced by a local guess at "the routes we know about", which
    // is the hardcoding this removed.
    getChains.mockRejectedValue(new Error("chains unavailable"));
    renderWithQueryClient(<BridgeOverviewStats />);

    expect(await screen.findByText("In-flight transfers")).toBeInTheDocument();
    expect(screen.queryByText(/Settled into/)).toBeNull();
  });
});

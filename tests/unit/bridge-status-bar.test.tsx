import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { BridgeStatusBar } from "@/components/layout/BridgeStatusBar";
import { SYSTEM_ROUTE_MESSAGE } from "@/lib/bridge";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";

/**
 * The global trust strip, rendered.
 *
 * Two sentences this file exists to keep out. The first is the original
 * "Paused — The bridge is paused on both sides.", along with the
 * `goldcoin_paused && solana_paused` derivation behind it. The second is
 * subtler and replaced it: calling a route that ships `enabled: false`
 * "temporarily unavailable", which promises a self-healing that only an
 * operator can deliver.
 *
 * The strip states no per-route reason in any state. The backend
 * publishes a cause-agnostic sentence per route and there can be several
 * distinct ones at once, so /status is where they are rendered — beside
 * the route each belongs to.
 */

const getStatus = vi.fn();
const getChains = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
  },
}));

const now = () => new Date();

type RouteState = "available" | "disabled" | "unavailable";

/**
 * `/chains` with each executable route forced into one of the three
 * states, spelled as the backend's `route_availability` spells it: a
 * disabled route carries the ROUTE-GATE copy, a runtime-gated one the
 * DIRECTION copy, and both report `available: false`.
 */
function chainsWith(states: Record<string, RouteState>): ChainsViewDto {
  const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route): RouteViewDto => {
      const state = states[route.id];
      if (state === undefined) return route;
      if (state === "available") {
        return {
          ...route,
          enabled: true,
          disabled_reason: null,
          available: true,
          unavailable_reason: null,
        };
      }
      if (state === "disabled") {
        return {
          ...route,
          enabled: false,
          disabled_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
          available: false,
          unavailable_reason: fixtures.ROUTE_UNAVAILABLE_MESSAGE,
        };
      }
      return {
        ...route,
        enabled: true,
        disabled_reason: null,
        available: false,
        unavailable_reason: fixtures.DIRECTION_UNAVAILABLE_MESSAGE,
      };
    }),
  };
}

const ALL: Record<string, RouteState> = {
  GlcToSol: "available",
  SolToGlc: "available",
  GlcToRhn: "available",
  RhnToGlc: "available",
};

const bar = () =>
  renderWithQueryClient(<BridgeStatusBar initialStatus={fixtures.statusFixture(now)} />);

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(now));
  getChains.mockResolvedValue(chainsWith(ALL));
});

describe("BridgeStatusBar wording, per banner state", () => {
  it("counts the available routes when every executable route is open", async () => {
    bar();

    expect(await screen.findByText("4 of 4 routes available.")).toBeInTheDocument();
    expect(screen.getByText("Operational")).toBeInTheDocument();
    // No warning at all: there is nothing to warn about.
    expect(screen.queryByText(/unavailable|disabled/i)).toBeNull();
  });

  it("says DISABLED, not temporarily unavailable, for a switched-off route", async () => {
    // `GlcToRhn` ships `enabled: false` and reopens only when an operator
    // changes something. "Temporarily" would be a promise nobody made.
    getChains.mockResolvedValue(chainsWith({ ...ALL, GlcToRhn: "disabled" }));
    bar();

    expect(await screen.findByText(SYSTEM_ROUTE_MESSAGE.disabled)).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText(/temporarily/i)).toBeNull();
  });

  it("says TEMPORARILY UNAVAILABLE for an enabled route its reserve is holding shut", async () => {
    getChains.mockResolvedValue(chainsWith({ ...ALL, RhnToGlc: "unavailable" }));
    bar();

    expect(await screen.findByText(SYSTEM_ROUTE_MESSAGE.unavailable)).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText(/currently disabled/i)).toBeNull();
  });

  it("says both when both are true at once", async () => {
    getChains.mockResolvedValue(
      chainsWith({ ...ALL, GlcToRhn: "disabled", RhnToGlc: "unavailable" }),
    );
    bar();

    expect(await screen.findByText(SYSTEM_ROUTE_MESSAGE.mixed)).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
  });

  it("reports a full outage as maintenance across all routes", async () => {
    getChains.mockResolvedValue(
      chainsWith({
        GlcToSol: "unavailable",
        SolToGlc: "unavailable",
        GlcToRhn: "disabled",
        RhnToGlc: "disabled",
      }),
    );
    bar();

    expect(await screen.findByText(SYSTEM_ROUTE_MESSAGE.none)).toBeInTheDocument();
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("says it is still checking before /chains answers", () => {
    getChains.mockReturnValue(new Promise(() => undefined));
    bar();

    expect(screen.getByText(SYSTEM_ROUTE_MESSAGE.unknown)).toBeInTheDocument();
    // Fail closed: an unanswered registry is not an available bridge.
    expect(screen.queryByText("Operational")).toBeNull();
  });

  it("says the bridge is unreachable when the status snapshot fails", async () => {
    getStatus.mockRejectedValue(new Error("offline"));
    renderWithQueryClient(<BridgeStatusBar />);

    expect(await screen.findByText(/Bridge status unavailable/)).toBeInTheDocument();
  });
});

describe("what the strip never says", () => {
  it("never says the bridge is paused on both sides, in any state", async () => {
    for (const chains of [
      chainsWith(ALL),
      chainsWith({ ...ALL, GlcToSol: "unavailable" }),
      chainsWith({ ...ALL, GlcToRhn: "disabled" }),
      chainsWith({
        GlcToSol: "disabled",
        SolToGlc: "disabled",
        GlcToRhn: "disabled",
        RhnToGlc: "disabled",
      }),
    ]) {
      getChains.mockResolvedValue(chains);
      const view = bar();
      await screen.findByRole("link", { name: "View status" });
      const text = document.body.textContent;
      expect(text).not.toMatch(/both sides/i);
      expect(text).not.toMatch(/both directions/i);
      view.unmount();
    }
  });

  it("links to status rather than repeating a route's reason", async () => {
    getChains.mockResolvedValue(
      chainsWith({ ...ALL, GlcToRhn: "disabled", RhnToGlc: "unavailable" }),
    );
    bar();

    await screen.findByText(SYSTEM_ROUTE_MESSAGE.mixed);
    // Both backend sentences are in this response, and neither belongs in
    // a one-line strip: /status renders each beside its own route.
    expect(screen.queryByText(fixtures.DIRECTION_UNAVAILABLE_MESSAGE)).toBeNull();
    expect(
      screen.queryByText(new RegExp("Robinhood Network support is in development")),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "View status" })).toHaveAttribute(
      "href",
      "/status",
    );
  });

  it("does not derive its state from the reserve pause booleans", async () => {
    // `goldcoin_paused` and `solana_paused` both set, every route
    // available. The old derivation printed "paused on both sides" here;
    // the pause flags are a reserve-level detail /status reports per
    // route, and they are not the bridge's availability.
    const paused = {
      ...fixtures.statusFixture(now),
      goldcoin_paused: true,
      solana_paused: true,
    };
    getStatus.mockResolvedValue(paused);
    renderWithQueryClient(<BridgeStatusBar initialStatus={paused} />);

    expect(await screen.findByText("4 of 4 routes available.")).toBeInTheDocument();
  });
});

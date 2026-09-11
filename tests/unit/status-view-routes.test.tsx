import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import { AVAILABILITY_NOT_PUBLISHED_NOTE } from "@/lib/bridge";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { ChainsViewDto, RouteViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";

/**
 * /status, rendered for all four executable routes at once.
 *
 * `route-status.test.ts` pins each figure to the API field it came from.
 * This file is the other half: that the page actually SHOWS four routes,
 * that the four numbers on screen are four different numbers, and that the
 * badge on each card tracks `available` rather than `enabled`.
 *
 * The fixture below gives every slot a distinct value on purpose. A figure
 * that leaked from one route to another would otherwise be invisible here
 * — two cards showing the same plausible number look exactly like two
 * cards showing the right ones.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();
const getRobinhoodReserve = vi.fn();
const getRobinhoodLimits = vi.fn();
const getLimits = vi.fn();
const getStats = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getRobinhoodReserve: (...args: unknown[]) => getRobinhoodReserve(...args),
    getRobinhoodLimits: (...args: unknown[]) => getRobinhoodLimits(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getStats: (...args: unknown[]) => getStats(...args),
  },
}));

const now = () => new Date();

/* Eight distinct figures, one per slot. */
const GOLDCOIN_CAPACITY = { atomic: "111100000000", display: "1,111.00" }; // 8dp
const SOLANA_CAPACITY = { atomic: "222200000", display: "222.20" }; // 6dp
const ROBINHOOD_CAPACITY = { atomic: "333300000000", display: "3,333.00" }; // 8dp
const GLC_TO_SOL_WINDOW = { atomic: "444400000", display: "444.40" }; // 6dp
const SOL_TO_GLC_WINDOW = { atomic: "555500000", display: "555.50" }; // 6dp
const OUTBOUND_WINDOW = { atomic: "666600000000000000000", display: "666.60" }; // 18dp
const INBOUND_WINDOW = { atomic: "777700000000000000000", display: "777.70" }; // 18dp

const CARDS = {
  GlcToSol: "GLC L1 → GLC on Solana",
  SolToGlc: "GLC on Solana → GLC L1",
  GlcToRhn: "GLC L1 → GLC on Robinhood",
  RhnToGlc: "GLC on Robinhood → GLC L1",
} as const;

function robinhoodReserve(): RobinhoodReserveDto {
  const base = fixtures.robinhoodReserveFixture(now, { open: true });
  return {
    ...base,
    available_capacity_atomic: ROBINHOOD_CAPACITY.atomic,
    onchain: {
      ...base.onchain,
      outbound_window: {
        ...base.onchain.outbound_window!,
        remaining_atomic: OUTBOUND_WINDOW.atomic,
      },
      inbound_window: {
        ...base.onchain.inbound_window!,
        remaining_atomic: INBOUND_WINDOW.atomic,
      },
    },
  };
}

/** `/chains` with each executable route's `available` set as given. */
function chainsWith(available: Record<string, boolean>): ChainsViewDto {
  const base = fixtures.chainsFixture(now, { robinhoodOpen: true });
  return {
    ...base,
    routes: base.routes.map((route): RouteViewDto => {
      const value = available[route.id];
      if (value === undefined) return route;
      return {
        ...route,
        enabled: true,
        disabled_reason: null,
        available: value,
        unavailable_reason: value ? null : fixtures.DIRECTION_UNAVAILABLE_MESSAGE,
      };
    }),
  };
}

const ALL = { GlcToSol: true, SolToGlc: true, GlcToRhn: true, RhnToGlc: true };

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue({
    ...fixtures.statusFixture(now),
    glc_to_sol_rolling_volume_remaining: GLC_TO_SOL_WINDOW.atomic,
    sol_to_glc_rolling_volume_remaining: SOL_TO_GLC_WINDOW.atomic,
  });
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue({
    goldcoin_available_capacity: GOLDCOIN_CAPACITY.atomic,
    solana_available_capacity: SOLANA_CAPACITY.atomic,
  });
  getChains.mockResolvedValue(chainsWith(ALL));
  getRobinhoodReserve.mockResolvedValue(robinhoodReserve());
  getRobinhoodLimits.mockResolvedValue(
    fixtures.robinhoodLimitsFixture(now, { open: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  // `route_fees` — the per-route price table. The fixture prices the
  // Robinhood pair differently from the Solana pair on purpose.
  getStats.mockResolvedValue(fixtures.statsFixture());
});

async function card(route: keyof typeof CARDS) {
  return within(await screen.findByRole("group", { name: CARDS[route] }));
}

describe("all four executable routes get a card", () => {
  it("renders one card per executable route", async () => {
    renderWithQueryClient(<StatusView />);
    for (const title of Object.values(CARDS)) {
      expect(await screen.findByRole("group", { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Destination reserve capacity")).toHaveLength(4);
  });

  it("gives no card to a route with no settlement machinery", async () => {
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("group", { name: CARDS.GlcToSol });

    // `SolToRhn`/`RhnToSol` are `implemented: false`: no reserve pays them
    // and no window bounds them, so there is no figure to put on a card.
    expect(
      screen.queryByRole("group", { name: "GLC on Solana → GLC on Robinhood" }),
    ).toBeNull();
    expect(
      screen.queryByRole("group", { name: "GLC on Robinhood → GLC on Solana" }),
    ).toBeNull();
  });

  it("still lists the two cross routes, now as built-but-closed", async () => {
    // They used to report "Not implemented". Phase H built them, so the
    // Routes card lists them as unavailable — still closed, and still
    // listed, which is the part that matters: a route the deployment
    // knows about never silently disappears from this card.
    renderWithQueryClient(<StatusView />);
    await screen.findByRole("heading", { name: "Routes" });
    const list = within(screen.getByRole("list"));

    // No longer "Not implemented", and no longer the flat "Not available
    // on this deployment." that verdict carries: a built-but-closed route
    // shows the BACKEND's own reason, exactly as the other closed routes
    // already did.
    expect(list.queryByText("Not implemented")).toBeNull();
    expect(list.queryByText("Not available on this deployment.")).toBeNull();
    for (const id of ["SolToRhn", "RhnToSol"]) {
      expect(list.getByText(id)).toBeInTheDocument();
    }
    // Neutral, not danger: nothing is wrong and nothing is waiting to be
    // switched back on.
    expect(list.queryByText("Paused")).toBeNull();
  });
});

describe("the four cards show four different sets of figures", () => {
  it("gives each route its own destination capacity", async () => {
    renderWithQueryClient(<StatusView />);

    expect(
      (await card("GlcToSol")).getByText(new RegExp(SOLANA_CAPACITY.display)),
    ).toBeInTheDocument();
    expect(
      (await card("SolToGlc")).getByText(new RegExp(GOLDCOIN_CAPACITY.display)),
    ).toBeInTheDocument();
    expect(
      await (await card("GlcToRhn")).findByText(new RegExp(ROBINHOOD_CAPACITY.display)),
    ).toBeInTheDocument();
    // RhnToGlc settles onto the GOLDCOIN reserve — the same pool SolToGlc
    // pays out of, so the same figure. That sharing is the backend's, not
    // a fallback: the Robinhood ledger's own capacity is a different number
    // and is absent from this card entirely.
    const rhnToGlc = await card("RhnToGlc");
    expect(rhnToGlc.getByText(new RegExp(GOLDCOIN_CAPACITY.display))).toBeInTheDocument();
    expect(rhnToGlc.queryByText(new RegExp(ROBINHOOD_CAPACITY.display))).toBeNull();
  });

  it("gives each route its own 24-hour window, in its own unit", async () => {
    renderWithQueryClient(<StatusView />);

    expect(
      (await card("GlcToSol")).getByText(new RegExp(GLC_TO_SOL_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      (await card("SolToGlc")).getByText(new RegExp(SOL_TO_GLC_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      await (await card("GlcToRhn")).findByText(new RegExp(OUTBOUND_WINDOW.display)),
    ).toBeInTheDocument();
    expect(
      (await card("RhnToGlc")).getByText(new RegExp(INBOUND_WINDOW.display)),
    ).toBeInTheDocument();
  });

  it("never shows one route's window on another route's card", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText(new RegExp(OUTBOUND_WINDOW.display));

    for (const [route, forbidden] of [
      ["GlcToSol", [SOL_TO_GLC_WINDOW, OUTBOUND_WINDOW, INBOUND_WINDOW]],
      ["SolToGlc", [GLC_TO_SOL_WINDOW, OUTBOUND_WINDOW, INBOUND_WINDOW]],
      ["GlcToRhn", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, INBOUND_WINDOW]],
      ["RhnToGlc", [GLC_TO_SOL_WINDOW, SOL_TO_GLC_WINDOW, OUTBOUND_WINDOW]],
    ] as const) {
      const scope = await card(route);
      for (const figure of forbidden) {
        expect(
          scope.queryByText(new RegExp(figure.display)),
          `${route} is showing ${figure.display}, which is another route's figure`,
        ).toBeNull();
      }
    }
  });

  it("reports the fee and the limits each route actually has", async () => {
    renderWithQueryClient(<StatusView />);
    const glcToSol = await card("GlcToSol");
    expect(glcToSol.getByText("3%")).toBeInTheDocument();
    // The MAXIMUM is the Solana program's `per_transfer_limit`,
    // 20000000000 at the mint's 6 decimals. The MINIMUM is the published
    // policy floor — deliberately NOT the program's 99 GLC
    // `min_transfer_amount`, which is a net-side check and was what this
    // row used to show.
    expect(glcToSol.getByText(/100\.00/)).toBeInTheDocument();
    expect(glcToSol.getByText(/20,000\.00/)).toBeInTheDocument();
    expect(glcToSol.queryByText(/99\.00/)).toBeNull();

    // Its OWN rate from `route_fees`, not the Solana pair's — the
    // fixtures price the two families differently precisely so this
    // distinguishes a correct card from one reading `bridge_fee_bps`.
    const glcToRhn = await card("GlcToRhn");
    expect(glcToRhn.getByText("2.50%")).toBeInTheDocument();
    expect(glcToRhn.queryByText("3%")).toBeNull();
  });

  it("shows a Robinhood route's per-transfer limits, from the contract", async () => {
    // This row used to be absent on a Robinhood card: `GET /limits`
    // carries the Solana program's config alone, and filling the row from
    // it would state a ceiling neither Robinhood chain enforces. The
    // figures now come from the places that DO enforce them — the
    // published policy floor, and `GET /robinhood/limits`' own
    // `outboundMax`.
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText("Per-transfer limits");
    expect(glcToRhn.getByText(/100\.00/)).toBeInTheDocument();
    expect(glcToRhn.getByText(/20,000\.00/)).toBeInTheDocument();
    expect(glcToRhn.queryByText("Not published")).toBeNull();
  });

  it("omits the limits row entirely when the contract could not be read", async () => {
    // Absent rather than a placeholder, which is what made the card read
    // as unfinished — and absent rather than zero, which would say the
    // route takes nothing.
    getRobinhoodLimits.mockResolvedValue(
      fixtures.robinhoodLimitsFixture(() => new Date(), { open: false }),
    );
    renderWithQueryClient(<StatusView />);
    const glcToRhn = await card("GlcToRhn");
    await glcToRhn.findByText("Route fee");
    expect(glcToRhn.queryByText(/20,000\.00/)).toBeNull();
  });
});

describe("route.available controls the badge", () => {
  it("shows Available only where the backend answered available: true", async () => {
    renderWithQueryClient(<StatusView />);
    for (const route of ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const) {
      const scope = await card(route);
      expect(await scope.findByText("Available")).toBeInTheDocument();
      expect(scope.getByText("Available (effective)").parentElement).toHaveTextContent(
        "Yes",
      );
    }
  });

  it("turns one card unavailable without touching the other three", async () => {
    getChains.mockResolvedValue(chainsWith({ ...ALL, RhnToGlc: false }));
    renderWithQueryClient(<StatusView />);

    const rhnToGlc = await card("RhnToGlc");
    expect(await rhnToGlc.findByText("Temporarily unavailable")).toBeInTheDocument();
    // Switched on and still refused: both facts, side by side, because
    // reading the first as permission is what this distinction exists for.
    expect(rhnToGlc.getByText("Enabled (route gate)").parentElement).toHaveTextContent(
      "Yes",
    );
    expect(rhnToGlc.getByText("Available (effective)").parentElement).toHaveTextContent(
      "No",
    );
    expect(
      rhnToGlc.getByText(fixtures.DIRECTION_UNAVAILABLE_MESSAGE),
    ).toBeInTheDocument();

    expect((await card("GlcToRhn")).getByText("Available")).toBeInTheDocument();
  });

  it("never calls an enabled-but-unanswered route available", async () => {
    // A deployment predating backend PR #76 publishes no `available`.
    const open = chainsWith(ALL);
    getChains.mockResolvedValue({
      ...open,
      routes: open.routes.map((route) => {
        const { available: _a, unavailable_reason: _r, ...rest } = route;
        return rest;
      }),
    });
    renderWithQueryClient(<StatusView />);

    const glcToSol = await card("GlcToSol");
    expect(await glcToSol.findByText("Unknown")).toBeInTheDocument();
    expect(glcToSol.getByText("Enabled (route gate)").parentElement).toHaveTextContent(
      "Yes",
    );
    // The question was never answered, so no verdict is shown. Rendering
    // "No" would be a claim the backend did not make, and rendering "Not
    // published" put placeholder text where a reader expects a value —
    // the badge above already reads Unknown, and the note says why.
    expect(glcToSol.queryByText("Available (effective)")).toBeNull();
    expect(glcToSol.queryByText("Not published")).toBeNull();
    expect(
      glcToSol.getByText(AVAILABILITY_NOT_PUBLISHED_NOTE, { exact: false }),
    ).toBeInTheDocument();
  });

  it("keeps the figures visible on a route the backend has closed", async () => {
    // A closed route still has a destination reserve with a real capacity.
    // Hiding the number would be a second, quieter claim about the route.
    getChains.mockResolvedValue(chainsWith({ ...ALL, SolToGlc: false }));
    renderWithQueryClient(<StatusView />);

    const solToGlc = await card("SolToGlc");
    expect(await solToGlc.findByText("Temporarily unavailable")).toBeInTheDocument();
    expect(solToGlc.getByText(new RegExp(GOLDCOIN_CAPACITY.display))).toBeInTheDocument();
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { TransferRow } from "@/features/activity/TransferRow";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import { TransferStepper } from "@/features/transfer/TransferStepper";
import { routeDisplay } from "@/lib/bridge";
import { routeSchema } from "@/lib/api/schemas/common";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";
import type { Route } from "@/lib/api/schemas/common";

/**
 * The read-only surfaces, across all six routes.
 *
 * These pages describe money that has ALREADY moved, so none of them may
 * depend on a route being open, startable, or one of the four that used to
 * have settlement machinery — a settled `RhnToSol` row has to render
 * correctly on a deployment that has since closed the route.
 *
 * Every derivation under test is keyed on the route's CHAIN rather than on
 * its name, which is the property that made them total over six routes
 * without a new branch. The cases below are the cross routes specifically,
 * because a name check (`=== "RhnToGlc"`) passes every four-route test and
 * fails only on them.
 */

const getTransfer = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: { getTransfer: (...args: unknown[]) => getTransfer(...args) },
}));

const GOLDCOIN_TXID = "a".repeat(64);
const SOLANA_SIG = "5".repeat(64);
const EVM_HASH = `0x${"b".repeat(64)}`;

/** A settled transfer on one route, with a source and destination hash. */
function settled(direction: Route, sourceTxid: string, destinationTxid: string) {
  return {
    ...fixtures.transfersFixture()[0]!,
    id: 9001,
    direction,
    state: "Settled" as const,
    source_txid: sourceTxid,
    destination_txid: destinationTxid,
    refund: null,
  } satisfies TransferViewDto;
}

describe("route labels are total over the vocabulary", () => {
  it("names every route from its two chains, with nothing hardcoded per route", () => {
    // `routeDisplay` used to be two tables with a branch between them: the
    // four with settlement machinery, and a display-only pair beside it.
    // One table now, so a label cannot exist for a route the rest of the
    // app has no descriptor for.
    for (const route of routeSchema.options) {
      const display = routeDisplay(route);
      expect(display.label).toBe(`${display.from.token.name} → ${display.to.token.name}`);
      expect(display.from.chain.id).not.toBe(display.to.chain.id);
    }
  });

  it("gives the cross routes the same token names every other route uses", () => {
    // The Robinhood token at its real 18 decimals and the Solana mint at 6,
    // on both cross routes. A display-only table is exactly where a
    // forgotten decimals value would sit unnoticed.
    expect(routeDisplay("SolToRhn").from.token.decimals).toBe(6);
    expect(routeDisplay("SolToRhn").to.token.decimals).toBe(18);
    expect(routeDisplay("RhnToSol").from.token.decimals).toBe(18);
    expect(routeDisplay("RhnToSol").to.token.decimals).toBe(6);
  });
});

describe("the activity row", () => {
  it.each(routeSchema.options)("labels a %s transfer by its own two tokens", (route) => {
    const display = routeDisplay(route);
    renderWithQueryClient(
      <TransferRow transfer={settled(route, GOLDCOIN_TXID, SOLANA_SIG)} />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent(display.from.token.name);
    expect(link).toHaveTextContent(display.to.token.name);
  });

  it("never falls back to another route's label", () => {
    // One row per route, rendered together: six distinct labels. A missing
    // descriptor that silently resolved to a neighbour would show up as a
    // duplicate here and nowhere else.
    const labels = routeSchema.options.map((route) => {
      const { unmount } = renderWithQueryClient(
        <TransferRow transfer={settled(route, GOLDCOIN_TXID, SOLANA_SIG)} />,
      );
      const text = screen.getByRole("link").textContent;
      unmount();
      return text;
    });
    expect(new Set(labels).size).toBe(6);
  });
});

describe("the transfer stepper", () => {
  it("gives neither cross route a Goldcoin confirmation step", () => {
    // `Confirming` belongs to GOLDCOIN-SOURCED routes: a Goldcoin deposit is
    // tracked block by block, a contract-sourced one folds straight to
    // `SourceFinalized`. Neither cross route touches Goldcoin at all, and
    // the rule is keyed on the source chain — so neither needed a new arm.
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      const { unmount } = renderWithQueryClient(
        <TransferStepper
          direction={route}
          state="SourceFinalized"
          sourceConfirmations={0}
          requiredSourceConfirmations={null}
        />,
      );
      expect(screen.queryByText("Confirming")).toBeNull();
      expect(screen.getByText("Source confirmed")).toBeInTheDocument();
      unmount();
    }
  });
});

describe("the transfer detail page", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ["SolToRhn", SOLANA_SIG, EVM_HASH],
    ["RhnToSol", EVM_HASH, SOLANA_SIG],
  ] as const)(
    "renders a settled %s with its own heading",
    async (route, source, dest) => {
      getTransfer.mockResolvedValue(settled(route, source, dest));
      renderWithQueryClient(<TransferDetail id={9001} />);

      expect(
        await screen.findByRole("heading", {
          name: new RegExp(routeDisplay(route).label),
        }),
      ).toBeInTheDocument();
      // Both transaction rows render; which explorer each goes to is
      // `chain-explorer-links`' business and is asserted there.
      expect(screen.getByText("Source transaction")).toBeInTheDocument();
      expect(screen.getByText("Destination transaction")).toBeInTheDocument();
    },
  );

  it("explains the missing refund figure on a Robinhood-SOURCED cross route", async () => {
    // `TransferView.refund` is absent by design for a deposit held in the
    // custody contract: it refunds on the Robinhood side, from a different
    // table in a different unit. That used to be matched as
    // `direction === "RhnToGlc"`, which left `RhnToSol` — the same contract,
    // the same absent record — with a bare "Not available on this page" and
    // no explanation. It is read off the SOURCE CHAIN now.
    getTransfer.mockResolvedValue({
      ...settled("RhnToSol", EVM_HASH, SOLANA_SIG),
      state: "Refunded" as const,
      refund: null,
    });
    renderWithQueryClient(<TransferDetail id={9001} />);

    await screen.findByRole("heading", {
      name: new RegExp(routeDisplay("RhnToSol").label),
    });
    expect(
      screen.getByText(/refunded on Robinhood Network, from the custody contract/),
    ).toBeInTheDocument();
  });

  it("does not offer that explanation on a route NOT sourced from Robinhood", async () => {
    // The complement. `SolToRhn` deposits into the Solana program, so its
    // refund is not the custody contract's to make — the Robinhood
    // paragraph would be a false statement about where the money is. The
    // check has to be the source chain, not "does this route touch
    // Robinhood at all", which both cross routes do.
    getTransfer.mockResolvedValue({
      ...settled("SolToRhn", SOLANA_SIG, EVM_HASH),
      state: "Refunded" as const,
      refund: null,
    });
    renderWithQueryClient(<TransferDetail id={9001} />);

    await screen.findByRole("heading", {
      name: new RegExp(routeDisplay("SolToRhn").label),
    });
    expect(screen.queryByText(/from the custody contract that holds it/)).toBeNull();
  });
});

describe("explorer links resolve by chain, never by route", () => {
  const GOLDCOIN_TEMPLATE = "https://explorer.goldcoin.test/tx/{value}";
  const SOLANA_TEMPLATE = "https://explorer.solana.test/tx/{value}";
  const ROBINHOOD_TEMPLATE = "https://explorer.robinhood.test/tx/{value}";

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function links() {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_GLC_EXPLORER_TX_URL", GOLDCOIN_TEMPLATE);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL", SOLANA_TEMPLATE);
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_TX_URL", ROBINHOOD_TEMPLATE);
    return import("@/lib/config/links");
  }

  it("sends each side of a cross route to its own chain's explorer", async () => {
    const { chainTxUrl } = await links();
    for (const route of ["SolToRhn", "RhnToSol"] as const) {
      const display = routeDisplay(route);
      const sourceUrl = chainTxUrl(display.from.chain.id, "aa");
      const destinationUrl = chainTxUrl(display.to.chain.id, "bb");
      expect(sourceUrl).toContain(`explorer.${display.from.chain.id}.test`);
      expect(destinationUrl).toContain(`explorer.${display.to.chain.id}.test`);
      // And the two sides are genuinely different hosts — the failure a
      // direction-shaped check produces is one of them resolving to the
      // other's explorer, which looks right and shows the wrong chain.
      expect(sourceUrl).not.toBe(destinationUrl);
    }
  });

  it("covers every chain any route names, so no side is ever unlinked", async () => {
    const { chainTxUrl } = await links();
    for (const route of routeSchema.options) {
      const display = routeDisplay(route);
      expect(chainTxUrl(display.from.chain.id, "aa")).not.toBeNull();
      expect(chainTxUrl(display.to.chain.id, "bb")).not.toBeNull();
    }
  });
});

describe("the route list the UI can name is the backend's own", () => {
  it("has a descriptor for every route the wire enum defines", async () => {
    // The guard against the state this change started from: a route the
    // backend can send that the UI has no way to describe, which used to
    // mean a display-only table and a branch to reach it.
    const { directions } = await import("@/lib/bridge/direction");
    expect(Object.keys(directions).sort()).toEqual([...routeSchema.options].sort());
  });

  it("names a destination reserve for every route", async () => {
    // The field /status and /reserves both key their figures on. A route
    // without one would get a card with no capacity and no group on the
    // reserves page, silently.
    const { directions } = await import("@/lib/bridge/direction");
    for (const route of routeSchema.options) {
      expect(["goldcoin", "solana", "robinhood"]).toContain(
        directions[route].destinationReserve,
      );
      // And it is the DESTINATION chain's reserve, never the source's —
      // the mistake the two cross routes make easy, since each settles onto
      // the pool its name's second half points at.
      expect(directions[route].destinationReserve).toBe(directions[route].to.chain.id);
    }
  });
});

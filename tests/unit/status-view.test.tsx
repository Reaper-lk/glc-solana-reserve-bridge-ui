import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { StatusView } from "@/features/status/StatusView";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The Routes card on /status.
 *
 * Its whole job is to say which of the backend's routes can be used, and
 * the failure mode this file guards is a specific one: every non-open
 * route used to render the same "Paused" badge. That asserted a CAUSE that
 * `GET /chains` deliberately never publishes — `enabled` is the AND of
 * three independent gates and the response names none of them — and it
 * would say the same thing about a route reporting `implemented: false`,
 * which no operator can unpause because it was never built.
 *
 * It also guards the copy: with all six routes implemented, nothing on this
 * card may describe one as unbuilt, in development, or coming soon.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getHealth = vi.fn();
const getReserve = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getHealth: (...args: unknown[]) => getHealth(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getHealth.mockResolvedValue(fixtures.healthFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
});

/**
 * The Routes list, isolated from the two direction cards above it — those
 * carry their own badges from a different vocabulary, and counting badges
 * across the whole view would conflate the two.
 */
async function routesCard() {
  await screen.findByRole("heading", { name: "Routes" });
  return within(screen.getByRole("list"));
}

describe("StatusView route availability", () => {
  it("marks the open routes available", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    expect(card.getAllByText("Available")).toHaveLength(2);
  });

  it("does not call any route paused", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    // "Paused" is a cause. `/chains` publishes none, so this card may not
    // name one — that vocabulary belongs to the two direction cards above,
    // where `GET /status` does say which gate closed.
    expect(card.queryByText("Paused")).toBeNull();
  });

  it("shows every built-but-closed route as unavailable, not unimplemented", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();

    // All four non-default routes are built and refused by their gates:
    // GlcToRhn/RhnToGlc, and since Phase H the two cross routes as well.
    expect(card.getAllByText("Unavailable")).toHaveLength(4);
    // Nothing in this build reports `implemented: false` any more, so the
    // stronger "nothing to reopen" verdict must not appear.
    expect(card.queryByText("Not implemented")).toBeNull();
  });

  it("renders the backend's own reason rather than re-authoring one", async () => {
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();
    // Substring, because the constant is two lines and the DOM matcher
    // normalises whitespace — the point is that this copy is the backend's,
    // not that it survives a byte-for-byte comparison.
    expect(fixtures.ROUTE_UNAVAILABLE_MESSAGE).toContain(
      "switched off on this deployment",
    );
    expect(card.getAllByText(/switched off on this deployment/).length).toBeGreaterThan(
      0,
    );
  });

  it("never describes a closed route as unbuilt or coming soon", async () => {
    // The closed-route copy used to say Robinhood support was "in
    // development". Every route the backend names is now built and
    // settling, so that sentence described shipped machinery as unfinished
    // and told a reader to wait for something that had already landed.
    renderWithQueryClient(<StatusView />);
    await routesCard();
    expect(screen.queryByText(/in development/i)).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/launches/i)).toBeNull();
  });

  it("follows the backend when the routes open", async () => {
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
    );
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();

    // All six, because opening Robinhood is a deployment decision: the four
    // routes touching it share a custody contract, a reserve ledger and an
    // indexer, and the gate a closed one waits on is the same gate.
    expect(card.getAllByText("Available")).toHaveLength(6);
    expect(card.queryByText("Unavailable")).toBeNull();
    expect(card.queryByText("Not implemented")).toBeNull();
  });

  it("reports a maintenance pause as temporary on every affected route", async () => {
    // Switched ON and refused by a runtime gate: `available: false` with
    // `enabled: true`. A distinct badge from a closed route, because nobody
    // flipped a switch and nobody has to flip one back.
    getChains.mockResolvedValue(
      fixtures.chainsFixture(() => new Date(), {
        robinhoodOpen: true,
        robinhoodAvailable: false,
      }),
    );
    renderWithQueryClient(<StatusView />);
    const card = await routesCard();

    expect(card.getAllByText("Temporarily unavailable")).toHaveLength(4);
    // And NOT the red "Unavailable" a switched-off route carries, which
    // would send an operator looking for a setting that is already correct.
    expect(card.queryByText("Unavailable")).toBeNull();
    expect(
      card.getAllByText(fixtures.DIRECTION_UNAVAILABLE_MESSAGE).length,
    ).toBeGreaterThan(0);
  });
});

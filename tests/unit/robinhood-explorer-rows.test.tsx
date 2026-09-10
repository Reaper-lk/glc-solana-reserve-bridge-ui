import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { ExplorerFeed } from "@/features/explorer/ExplorerFeed";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import { TransferRow } from "@/features/activity/TransferRow";
import { render } from "@testing-library/react";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";

/**
 * Robinhood rows across the explorer, the activity list and the transfer
 * page, driven by MIXED Solana and Robinhood data.
 *
 * Mixed on purpose: every failure mode worth guarding here is a
 * cross-contamination one. A Robinhood row labelled with Solana's token
 * name, a `GlcToRhn` destination hash linked to the Goldcoin explorer
 * because the code branched on "is this GlcToSol", a `RhnToGlc` stepper
 * showing a Goldcoin confirmation ramp that route never has — none of
 * those show up in a fixture containing only one network's transfers.
 */

const listExplorerEvents = vi.fn();
const getTransfer = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    listExplorerEvents: (...args: unknown[]) => listExplorerEvents(...args),
    getTransfer: (...args: unknown[]) => getTransfer(...args),
  },
}));

/** The mixed feed the mock client serves under the `robinhood-open` scenario. */
const mixedEvents = () => ({
  items: fixtures.mixedExplorerEventsFixture(),
  next_cursor: null,
  as_of: 0,
});

const robinhoodTransfer = (id: number): TransferViewDto => {
  const found = fixtures.robinhoodTransfersFixture().find((t) => t.id === id);
  if (!found) throw new Error(`no Robinhood fixture ${id}`);
  return found;
};

beforeEach(() => {
  vi.resetAllMocks();
  listExplorerEvents.mockResolvedValue(mixedEvents());
});

describe("explorer feed with mixed Solana and Robinhood events", () => {
  it("labels each row with its own route, in both networks", async () => {
    renderWithQueryClient(<ExplorerFeed />);
    await screen.findAllByText("GLC L1 → GLC on Solana");

    expect(screen.getAllByText("GLC L1 → GLC on Robinhood").length).toBeGreaterThan(0);
    expect(screen.getAllByText("GLC on Robinhood → GLC L1").length).toBeGreaterThan(0);
    // The Solana rows are untouched by the Robinhood ones being present.
    expect(screen.getAllByText("GLC on Solana → GLC L1").length).toBeGreaterThan(0);
  });

  it("never labels a row with a route that has no settlement machinery", async () => {
    renderWithQueryClient(<ExplorerFeed />);
    await screen.findAllByText("GLC L1 → GLC on Solana");

    expect(screen.queryByText("GLC on Solana → GLC on Robinhood")).toBeNull();
    expect(screen.queryByText("GLC on Robinhood → GLC on Solana")).toBeNull();
  });

  it("links every row to its own request, Robinhood included", async () => {
    renderWithQueryClient(<ExplorerFeed />);
    const rows = await screen.findAllByText("GLC L1 → GLC on Robinhood");
    const hrefs = rows.map((row) => row.closest("a")?.getAttribute("href"));

    // Both GlcToRhn fixtures, each linking to its own request — inside the
    // explorer's own transfer route rather than the wallet-flow one. The
    // feed is newest-first, so the ids are asserted as a set, not in order.
    expect(new Set(hrefs)).toEqual(new Set(["/explorer/tx/2000", "/explorer/tx/2003"]));
  });

  it("exposes no counterparty address on any row", async () => {
    // `GET /explorer/events` deliberately carries none — not a recipient,
    // not a depositor, not an operator identity. Adding one client-side
    // would be the leak the endpoint was shaped to prevent.
    renderWithQueryClient(<ExplorerFeed />);
    await screen.findAllByText("GLC L1 → GLC on Robinhood");

    const body = document.body.textContent;
    expect(body).not.toContain("0x");
    expect(body).not.toMatch(/[13][a-km-zA-HJ-NP-Z1-9]{25,34}/);
  });
});

describe("activity rows", () => {
  it("names the Robinhood token on both sides of a Robinhood route", () => {
    const { container } = render(<TransferRow transfer={robinhoodTransfer(2001)} />);
    const text = container.textContent;

    expect(text).toContain("GLC on Robinhood");
    expect(text).toContain("GLC L1");
    expect(text).not.toContain("GLC on Solana");
  });
});

describe("TransferDetail for Robinhood routes", () => {
  it("renders a settled GlcToRhn with both transactions and its own label", async () => {
    getTransfer.mockResolvedValue(robinhoodTransfer(2000));
    renderWithQueryClient(<TransferDetail id={2000} />);

    expect(
      await screen.findByRole("heading", { name: /GLC L1 → GLC on Robinhood/ }),
    ).toBeInTheDocument();
    // Twice: the status badge, and the final step of the stepper.
    expect(screen.getAllByText("Settled")).toHaveLength(2);
    expect(screen.getByText("Source transaction")).toBeInTheDocument();
    expect(screen.getByText("Destination transaction")).toBeInTheDocument();
  });

  it("gives a contract-sourced RhnToGlc no Goldcoin confirmation step", async () => {
    // A Robinhood deposit folds straight to `SourceFinalized` once its
    // obligation is observed — there is no confirmation ramp, which is
    // exactly why `required_source_confirmations` is null for it.
    getTransfer.mockResolvedValue(robinhoodTransfer(2001));
    renderWithQueryClient(<TransferDetail id={2001} />);

    const stepper = await screen.findByRole("list");
    expect(within(stepper).getByText("Source confirmed")).toBeInTheDocument();
    expect(within(stepper).queryByText("Confirming")).toBeNull();
    expect(screen.queryByText(/of .* confirmations/)).toBeNull();
  });

  it("keeps the Goldcoin confirmation step on a Goldcoin-sourced GlcToRhn", async () => {
    getTransfer.mockResolvedValue(robinhoodTransfer(2003));
    renderWithQueryClient(<TransferDetail id={2003} />);

    const stepper = await screen.findByRole("list");
    expect(within(stepper).getByText("Confirming")).toBeInTheDocument();
  });

  it("explains a RhnToGlc refund instead of inventing an amount for it", async () => {
    // `TransferView.refund` is absent BY DESIGN for this route: the deposit
    // refunds on Robinhood, from a different table in a different unit, and
    // the backend reports no refund view rather than mislabelling one.
    getTransfer.mockResolvedValue(robinhoodTransfer(2002));
    renderWithQueryClient(<TransferDetail id={2002} />);

    expect(
      await screen.findByText("A refund for this transfer has been started."),
    ).toBeInTheDocument();
    expect(screen.getByText("Not available on this page")).toBeInTheDocument();
    expect(
      screen.getByText(/refunded on Robinhood Network, from the custody contract/),
    ).toBeInTheDocument();
    // The quote's fee and net are the figures that did NOT happen, and a
    // refunded request settles nothing.
    expect(screen.queryByText("You receive")).toBeNull();
  });

  it("carries no recipient or depositor address on the page", async () => {
    // `TransferView` has never had one, on any route. The read-only
    // explorer view is the same component for exactly that reason.
    getTransfer.mockResolvedValue(robinhoodTransfer(2001));
    renderWithQueryClient(<TransferDetail id={2001} />);
    await screen.findByRole("heading", { name: /GLC on Robinhood → GLC L1/ });

    // The source transaction hash is the transfer's own, not a party's.
    expect(screen.queryByText(/recipient/i)).toBeNull();
    expect(screen.queryByText(/depositor/i)).toBeNull();
  });

  it("renders each transaction as plain text when no template is configured", async () => {
    // The default test environment configures no explorer templates, and a
    // link to a guessed host is worse than no link. The hash is still
    // rendered and still copyable.
    getTransfer.mockResolvedValue(robinhoodTransfer(2000));
    renderWithQueryClient(<TransferDetail id={2000} />);
    await screen.findByText("Destination transaction");

    expect(screen.queryByRole("link")).toBeNull();
  });
});

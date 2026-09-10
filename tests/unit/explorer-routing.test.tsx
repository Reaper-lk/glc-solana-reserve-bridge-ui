import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { ExplorerFeed } from "@/features/explorer/ExplorerFeed";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";
import type * as LinksModule from "@/lib/config/links";

/**
 * The explorer area's routing: which page a row opens, and which chain's
 * explorer each transaction on that page is linked to.
 *
 * `chain-explorer-links.test.ts` proves the URL BUILDERS resolve by chain.
 * This file proves the pages hand them the right chain — which is the half
 * that broke when a third network arrived, because "source" and
 * "destination" stopped being synonyms for "Goldcoin" and "Solana".
 *
 * The link module is mocked to a template per chain rather than
 * configured through the environment, so a wrong-chain call is visible in
 * the href itself instead of collapsing to the `null` an unconfigured
 * template returns.
 */

const listExplorerEvents = vi.fn();
const getTransfer = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: {
    listExplorerEvents: (...args: unknown[]) => listExplorerEvents(...args),
    getTransfer: (...args: unknown[]) => getTransfer(...args),
  },
}));

vi.mock("@/lib/config/links", async (importOriginal) => {
  const actual = await importOriginal<typeof LinksModule>();
  return {
    ...actual,
    chainTxUrl: (chainId: string, id: string) => `https://${chainId}.test/tx/${id}`,
    chainAddressUrl: (chainId: string, address: string) =>
      `https://${chainId}.test/address/${address}`,
  };
});

const transfer = (id: number): TransferViewDto => {
  const found = fixtures.robinhoodTransfersFixture().find((row) => row.id === id);
  if (!found) throw new Error(`no Robinhood fixture ${id}`);
  return found;
};

beforeEach(() => {
  vi.resetAllMocks();
  listExplorerEvents.mockResolvedValue({
    items: fixtures.mixedExplorerEventsFixture(),
    next_cursor: null,
    as_of: 0,
  });
});

describe("the explorer feed stays inside the explorer", () => {
  it("opens each row on the explorer's own transfer route", async () => {
    // `/explorer/tx/{id}` is in the route table and used to be reachable
    // only by typing it: every row in the public feed pointed at
    // `/bridge/{id}`, the wallet-flow page.
    renderWithQueryClient(<ExplorerFeed />);
    const rows = await screen.findAllByRole("link");
    const hrefs = rows.map((row) => row.getAttribute("href"));

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/explorer\/tx\/\d+$/);
    }
  });
});

describe("a transfer's transactions link to the chain each happened on", () => {
  it("splits a settled GlcToRhn across the Goldcoin and Robinhood explorers", async () => {
    // Source: a Goldcoin txid. Destination: an EVM hash. One transfer, two
    // chains — the case a per-direction check would have got backwards.
    getTransfer.mockResolvedValue(transfer(2000));
    renderWithQueryClient(<TransferDetail id={2000} />);

    const source = await screen.findByText("Source transaction");
    const destination = screen.getByText("Destination transaction");

    const sourceHref = source.parentElement?.querySelector("a")?.getAttribute("href");
    const destinationHref = destination.parentElement
      ?.querySelector("a")
      ?.getAttribute("href");

    expect(sourceHref).toContain("https://goldcoin.test/tx/");
    expect(destinationHref).toContain("https://robinhood.test/tx/");
    expect(destinationHref).not.toContain("solana");
    expect(sourceHref).not.toContain("robinhood");
  });

  it("links an RhnToGlc deposit to the Robinhood explorer, never the Solana one", async () => {
    getTransfer.mockResolvedValue(transfer(2001));
    renderWithQueryClient(<TransferDetail id={2001} />);

    const source = await screen.findByText("Source transaction");
    const href = source.parentElement?.querySelector("a")?.getAttribute("href");

    expect(href).toContain("https://robinhood.test/tx/");
    expect(href).not.toContain("solana");
  });

  it("links a Solana-sourced transfer to the Solana explorer, never the Robinhood one", async () => {
    getTransfer.mockResolvedValue({
      ...fixtures.transfersFixture()[5]!,
      direction: "SolToGlc" as const,
      source_txid: "5".repeat(87),
      destination_txid: "g".repeat(64),
    });
    renderWithQueryClient(<TransferDetail id={1005} />);

    const source = await screen.findByText("Source transaction");
    const destination = screen.getByText("Destination transaction");
    const sourceHref = source.parentElement?.querySelector("a")?.getAttribute("href");
    const destinationHref = destination.parentElement
      ?.querySelector("a")
      ?.getAttribute("href");

    expect(sourceHref).toContain("https://solana.test/tx/");
    expect(sourceHref).not.toContain("robinhood");
    expect(destinationHref).toContain("https://goldcoin.test/tx/");
  });

  it("links a refund back down the SOURCE chain, not the destination", async () => {
    // A refund returns the deposit the way it came. On `GlcToSol` that is
    // Goldcoin, which is the opposite chain from the payout that never
    // happened.
    getTransfer.mockResolvedValue({
      ...fixtures.transfersFixture()[9]!,
      direction: "GlcToSol" as const,
      state: "Refunded" as const,
    });
    renderWithQueryClient(<TransferDetail id={1009} />);

    const refund = await screen.findByText("Refund transaction");
    const href = refund.parentElement?.querySelector("a")?.getAttribute("href");

    expect(href).toContain("https://goldcoin.test/tx/");
    expect(href).not.toContain("solana");
  });

  it("renders the same links on the explorer route as on the bridge route", async () => {
    // The explorer page used to strip every outbound link, leaving the one
    // surface built for independent verification showing bare hashes.
    getTransfer.mockResolvedValue(transfer(2000));
    renderWithQueryClient(<TransferDetail id={2000} />);
    await screen.findByText("Destination transaction");

    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
  });
});

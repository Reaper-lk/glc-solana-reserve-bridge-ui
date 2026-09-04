import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { ExplorerFeed } from "@/features/explorer/ExplorerFeed";
import * as fixtures from "@/lib/api/mock/fixtures";

const listExplorerEvents = vi.fn();
vi.mock("@/lib/api", () => ({
  bridgeApi: { listExplorerEvents: (...args: unknown[]) => listExplorerEvents(...args) },
}));

beforeEach(() => vi.resetAllMocks());

describe("ExplorerFeed", () => {
  it("shows a loading skeleton before data arrives", () => {
    listExplorerEvents.mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQueryClient(<ExplorerFeed />);
    expect(
      container.querySelectorAll('[class*="animate-shimmer"]').length,
    ).toBeGreaterThan(0);
  });

  it("renders a real empty state for a genuinely empty feed", async () => {
    listExplorerEvents.mockResolvedValue({ items: [], next_cursor: null, as_of: 0 });
    renderWithQueryClient(<ExplorerFeed />);
    expect(await screen.findByText(/No events yet/i)).toBeInTheDocument();
  });

  it("renders real events, including a from -> to state transition", async () => {
    listExplorerEvents.mockResolvedValue({
      items: fixtures.explorerEventsFixture().slice(0, 3),
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ExplorerFeed />);
    expect(await screen.findAllByText(/#\d+/)).not.toHaveLength(0);
  });

  it("never fabricates a next page — next_cursor null means no more, not an error", async () => {
    listExplorerEvents.mockResolvedValue({
      items: fixtures.explorerEventsFixture().slice(0, 2),
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ExplorerFeed />);
    await screen.findAllByText(/#\d+/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names each refund transition in plain English alongside the two badges", async () => {
    listExplorerEvents.mockResolvedValue({
      items: fixtures
        .explorerEventsFixture()
        .filter((event) => event.to_state.startsWith("Refund")),
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ExplorerFeed />);

    // The transition wording sits alongside the two state badges rather than
    // replacing them, and "Refund broadcast" is legitimately both a
    // transition name and a state label — hence getAllByText throughout.
    expect(await screen.findByText("Refund started")).toBeInTheDocument();
    expect(screen.getByText("Refund confirmed")).toBeInTheDocument();
    expect(screen.getAllByText("Refund broadcast").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Refund pending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Refunded").length).toBeGreaterThan(0);
  });

  it("degrades one unknown future state to its own row instead of failing the page", async () => {
    const [first, second, third] = fixtures.explorerEventsFixture();
    listExplorerEvents.mockResolvedValue({
      items: [first, { ...second, to_state: "SomeFutureLifecycleState" }, third],
      next_cursor: null,
      as_of: 0,
    });
    renderWithQueryClient(<ExplorerFeed />);

    // The unrecognised state renders as its own raw name...
    expect(await screen.findByText("SomeFutureLifecycleState")).toBeInTheDocument();
    // ...the page is not an error state...
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/No events yet/i)).not.toBeInTheDocument();
    // ...and every other row is still there.
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("surfaces an API failure rather than an empty feed", async () => {
    listExplorerEvents.mockRejectedValue(new Error("down"));
    renderWithQueryClient(<ExplorerFeed />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No events yet/i)).not.toBeInTheDocument();
  });
});

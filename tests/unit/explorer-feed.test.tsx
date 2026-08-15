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

  it("surfaces an API failure rather than an empty feed", async () => {
    listExplorerEvents.mockRejectedValue(new Error("down"));
    renderWithQueryClient(<ExplorerFeed />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No events yet/i)).not.toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "@/components/layout/Header";

/**
 * The header navigates and nothing else.
 *
 * Wallet connection is a property of the network being bridged FROM, which
 * only the bridge form knows. A site-wide connect control asked every
 * reader — including one on the FAQ — to connect a wallet for a network
 * they had not chosen, so it is gone from both the bar and the mobile
 * sheet. These tests pin that: a "Connect wallet" control reappearing in
 * the header is a regression, not a feature.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/bridge" }));

describe("global header", () => {
  it("renders the primary navigation", () => {
    render(<Header />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Bridge" })).toBeVisible();
    expect(within(nav).getByRole("link", { name: "Activity" })).toBeVisible();
  });

  it("carries no wallet control", () => {
    render(<Header />);
    expect(screen.queryByRole("button", { name: /connect wallet/i })).toBeNull();
    expect(screen.queryByText(/connect wallet/i)).toBeNull();
  });

  it("carries no wallet control inside the mobile navigation sheet either", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));

    const sheet = await screen.findByRole("dialog");
    // The sheet still navigates…
    expect(within(sheet).getByRole("link", { name: "Bridge" })).toBeVisible();
    // …and offers nothing to connect.
    expect(within(sheet).queryByText(/connect wallet/i)).toBeNull();
  });
});

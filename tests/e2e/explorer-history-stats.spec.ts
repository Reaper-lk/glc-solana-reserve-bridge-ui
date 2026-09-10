import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("explorer, reserves, and status navigation", () => {
  test("explorer shows real aggregate stats and a real event feed", async ({ page }) => {
    await page.goto("/explorer");
    await expect(page.getByRole("heading", { name: "Explorer" })).toBeVisible();
    await expect(page.getByText(/settled/i).first()).toBeVisible();
    // At least one real event row, linking to its own transfer inside the
    // explorer's own route rather than the wallet-flow one.
    await expect(page.locator('a[href^="/explorer/tx/"]').first()).toBeVisible();
  });

  test("an explorer event links through to its transfer detail", async ({ page }) => {
    await page.goto("/explorer");
    const firstEvent = page.locator('a[href^="/explorer/tx/"]').first();
    const href = await firstEvent.getAttribute("href");
    await firstEvent.click();
    await expect(page).toHaveURL(new RegExp(href!.replace(/\//g, "\\/")));
    await expect(page.getByText("Source transaction").first()).toBeVisible();
  });

  test("reserves page shows per-direction capacity and reconciliation history", async ({
    page,
  }) => {
    await page.goto("/reserves");
    await expect(page.getByRole("heading", { name: "Reserves" })).toBeVisible();
    await expect(page.getByText("Solana reserve")).toBeVisible();
    await expect(page.getByText("Goldcoin reserve")).toBeVisible();
    await expect(page.getByText(/Available capacity/i).first()).toBeVisible();
    await expect(page.getByText("Reconciliation history")).toBeVisible();
  });

  test("status page shows every executable route and system health", async ({ page }) => {
    await page.goto("/status");
    for (const route of [
      "GLC L1 → GLC on Solana",
      "GLC on Solana → GLC L1",
      "GLC L1 → GLC on Robinhood",
      "GLC on Robinhood → GLC L1",
    ]) {
      await expect(page.getByRole("group", { name: route })).toBeVisible();
    }
    await expect(page.getByText("System health")).toBeVisible();
    // The two-direction sentence the strip used to print in its worst
    // state. The bridge has four executable routes across three reserves.
    await expect(page.getByText(/both sides/i)).toHaveCount(0);
  });

  test("activity page states there is nothing to search without an address", async ({
    page,
  }) => {
    await page.goto("/activity");
    await expect(page.getByText(/No address to search/i)).toBeVisible();
  });

  test("activity search updates the URL and shows results for a real address", async ({
    page,
  }) => {
    await page.goto("/activity");
    await page
      .getByLabel(/Solana address/i)
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/address=9WzD/);
    await expect(page.locator('a[href^="/bridge/"]').first()).toBeVisible();
  });

  test("has no detectable accessibility violations on the explorer, reserves, and status pages", async ({
    page,
  }) => {
    for (const path of ["/explorer", "/reserves", "/status"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations,
        `${path}: ${JSON.stringify(results.violations, null, 2)}`,
      ).toEqual([]);
    }
  });
});

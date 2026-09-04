import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Transfer detail / tracking, using the mock backend's built-in fixture ids
 * (1000-1009, one per RequestState in fixtures.ts's SAMPLE_STATES).
 */

test.describe("transfer tracking", () => {
  test("shows a real in-flight state and its stepper", async ({ page }) => {
    // fixtures.ts index 0 -> id 1000, state AwaitingDeposit.
    await page.goto("/bridge/1000");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/#1000/);
    await expect(page.getByText(/Awaiting your deposit/i).first()).toBeVisible();
  });

  test("shows a manual-review transfer as under review, not failed or settled", async ({
    page,
  }) => {
    // index 7 -> id 1007, state ManualReview.
    await page.goto("/bridge/1007");
    await expect(page.getByText(/under manual review/i).first()).toBeVisible();
    await expect(page.getByText(/it is not lost/i)).toBeVisible();
  });

  test("shows an expired transfer as a real terminal failure state", async ({ page }) => {
    // index 8 -> id 1008, state Expired. Scoped past Next's own route
    // announcer, which also carries role="alert".
    await page.goto("/bridge/1008");
    const failure = page.getByRole("alert").filter({ hasText: "did not settle" });
    await expect(failure).toBeVisible();
  });

  test("shows a refunded transfer as refunded, not as a failure", async ({ page }) => {
    // index 9 -> id 1009, state Refunded.
    await page.goto("/bridge/1009");
    await expect(page.getByText(/this transfer was refunded/i)).toBeVisible();
    await expect(page.getByText(/returned to you/i)).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: "did not settle (" }),
    ).toHaveCount(0);
  });

  test("shows a not-found state for an unknown id rather than a blank page", async ({
    page,
  }) => {
    await page.goto("/bridge/999999999");
    await expect(page.getByText(/could not find that transfer/i)).toBeVisible();
  });

  test("survives a reload — no local state is required to reconstruct it", async ({
    page,
  }) => {
    await page.goto("/bridge/1000");
    await expect(page.getByText(/Awaiting your deposit/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Awaiting your deposit/i).first()).toBeVisible();
  });

  test("the same transfer is reachable read-only from the public explorer", async ({
    page,
  }) => {
    await page.goto("/explorer/tx/1000");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/#1000/);
  });

  test("has no detectable accessibility violations on a terminal-failure transfer", async ({
    page,
  }) => {
    await page.goto("/bridge/1008");
    // Wait past the loading skeleton (no heading during that transient
    // state) before scanning the settled page.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

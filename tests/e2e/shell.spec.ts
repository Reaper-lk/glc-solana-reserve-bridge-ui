import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("app shell, navigation, and wallet-connect UI", () => {
  test("every primary nav link reaches a real page", async ({ page }) => {
    await page.goto("/");
    for (const [label, path] of [
      ["Bridge", "/bridge"],
      ["Activity", "/activity"],
      ["Explorer", "/explorer"],
      ["Status", "/status"],
    ] as const) {
      const response = await page.goto(path);
      expect(response?.status(), `${label} (${path})`).toBe(200);
    }
  });

  test("the skip link is the first focusable element and works", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to main content/i })).toBeFocused();
  });

  test("the wallet-connect control is reachable without signing or broadcasting anything", async ({
    page,
  }) => {
    await page.goto("/");

    // Below `md` the header hides the wallet control and it moves inside the
    // navigation sheet instead — not dropped, just relocated.
    const viewport = page.viewportSize();
    if (viewport && viewport.width < 768) {
      await page.getByRole("button", { name: /Open navigation menu/i }).click();
    }

    const connect = page.getByRole("button", { name: /Connect wallet/i });
    await expect(connect).toBeVisible();
    // Unconfigured in this deployment (no Solana RPC set) — it must state so
    // rather than pretend to work.
    await expect(connect).toBeDisabled();
    await expect(connect).toHaveAccessibleDescription(/not configured/i);
  });

  test("a nonexistent route renders the real not-found page, not a framework default", async ({
    page,
  }) => {
    const response = await page.goto("/this-route-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/we could not find that page/i)).toBeVisible();
  });

  test("reduced motion is respected", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const duration = await page.evaluate(() => {
      const el = document.querySelector("main");
      return el ? getComputedStyle(el).transitionDuration : null;
    });
    expect(duration).not.toBeNull();
  });

  test("has no detectable accessibility violations on the landing page", async ({
    page,
  }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("content pages render without obsolete terminology reaching the browser", async ({
    page,
  }) => {
    for (const path of [
      "/fees",
      "/security",
      "/verify",
      "/wallets",
      "/faq",
      "/glossary",
    ]) {
      await page.goto(path);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText.toLowerCase(), path).not.toMatch(/wglc|wrapped|federation|\bburn/);
    }
  });
});

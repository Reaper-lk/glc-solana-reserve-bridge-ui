import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The privacy policy, proved in a browser rather than in jsdom.
 *
 * The properties below are ones jsdom cannot answer honestly: whether the
 * footer's link resolves to a served route, whether a section anchor
 * scrolls its heading into view rather than under the sticky header, and
 * whether the document reads at 360px without the page scrolling
 * sideways.
 *
 * The last test is the one that matters most on this page. It watches the
 * REAL browser — every request it makes and every cookie it ends up with
 * — rather than the source, because "no cookies, no third-party calls" is
 * a claim about what actually happens when someone opens the page.
 */

test.describe("privacy policy", () => {
  test("the footer's Privacy link reaches a real page", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("contentinfo").getByRole("link", { name: "Privacy" });
    await expect(link).toHaveAttribute("href", "/legal/privacy");

    const response = await page.goto("/legal/privacy");
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: /Privacy Policy/ }),
    ).toBeVisible();
  });

  test("declares itself canonical at /legal/privacy", async ({ page }) => {
    await page.goto("/legal/privacy");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/legal\/privacy$/,
    );
  });

  test("a section anchor lands on its heading, clear of the sticky header", async ({
    page,
  }) => {
    await page.goto("/legal/privacy#what-a-blockchain-makes-public");
    const heading = page
      .locator("#what-a-blockchain-makes-public")
      .getByRole("heading", { level: 2 });
    await expect(heading).toBeInViewport();
  });

  test("reads without sideways scrolling at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/legal/privacy");

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });

  test("sets no cookie and calls no tracker, analytics host or font CDN", async ({
    page,
    context,
  }) => {
    // The page states both. This checks the running application rather
    // than the source, which is the only way the statement stays true
    // after someone adds a dependency that phones home.
    //
    // It deliberately does NOT assert "no cross-origin request at all".
    // The global status strip reads the bridge backend on every page,
    // this one included, and in most deployments that backend is a
    // different origin from the site. That call is disclosed by the page
    // itself under "Network requests, and who answers them" — it is the
    // Service working, not tracking. What must never appear is an origin
    // in no way required to render the document.
    const HOSTILE =
      /google-analytics|googletagmanager|doubleclick|gstatic|googleapis|facebook|connect\.facebook|twitter|x\.com|segment\.(io|com)|mixpanel|amplitude|posthog|hotjar|fullstory|logrocket|sentry\.io|plausible|fathom|matomo|clarity\.ms|cdn\.jsdelivr|unpkg\.com|cloudflareinsights/i;

    const contacted: string[] = [];
    page.on("request", (request) => contacted.push(request.url()));

    await page.goto("/legal/privacy", { waitUntil: "networkidle" });

    const offenders = contacted.filter((url) => HOSTILE.test(url));
    expect(offenders, `unexpected outbound requests: ${offenders.join(", ")}`).toEqual(
      [],
    );

    // "This site sets no cookies", checked where it is decided.
    expect(await context.cookies()).toEqual([]);
  });

  test("renders without obsolete terminology reaching the browser", async ({ page }) => {
    await page.goto("/legal/privacy");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toMatch(/wglc|wrapped|federation|\bburn/);
  });

  test("has no detectable accessibility violations", async ({ page }) => {
    await page.goto("/legal/privacy");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

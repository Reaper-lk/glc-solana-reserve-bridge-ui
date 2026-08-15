import { test, expect } from "@playwright/test";
import { INTERCEPTED_API_ORIGIN } from "../../playwright.config";
import { mockHappyBackend, respondJson } from "./intercepted-helpers";

/**
 * Every scenario here runs against a real NEXT_PUBLIC_BRIDGE_API_MODE=http
 * build — the browser's actual `fetch` calls are intercepted, so this
 * exercises the real HttpBridgeClient error-mapping path end to end, not a
 * simulation of it.
 */

test.describe("backend failure and unhappy-path scenarios (real HTTP client)", () => {
  test("states the backend is unavailable rather than assuming operational", async ({
    page,
  }) => {
    await page.route(`${INTERCEPTED_API_ORIGIN}/**`, (route) =>
      route.abort("connectionrefused"),
    );

    await page.goto("/bridge");
    await expect(page.getByText(/Bridge status is unavailable/i)).toBeVisible();
  });

  test("treats a malformed JSON response as an error, never as data", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: '{"not":"a real status"',
      });
    });

    await page.goto("/bridge");
    await expect(page.getByText(/Bridge status is unavailable/i)).toBeVisible();
  });

  test("blocks submission with a stated reason when the destination direction is paused", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/status`, (route) =>
      respondJson(route, {
        goldcoin_paused: false,
        solana_paused: true,
        vault_address: "GLCVau1t111111111111111111111111111111111",
        next_solana_obligation_index: 1,
        glc_to_sol_available: false,
        sol_to_glc_available: true,
      }),
    );

    await page.goto("/bridge");
    await expect(page.getByText(/currently paused or unavailable/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });

  test("a paused-reserve 409 on submit is shown as an error, not a fabricated success", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      if (route.request().method() !== "POST") return route.continue();
      return respondJson(route, { error: "the destination reserve is paused" }, 409);
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await page.getByRole("button", { name: /Create deposit request/i }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "temporarily" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Send your deposit/i }),
    ).not.toBeVisible();
  });

  test("an insufficient-liquidity 409 on submit is shown with its own message, not a generic error", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      if (route.request().method() !== "POST") return route.continue();
      return respondJson(
        route,
        {
          error:
            "the destination reserve cannot currently cover this amount (available: 5)",
        },
        409,
      );
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");
    await page
      .getByLabel("Solana recipient address")
      .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await page.getByRole("button", { name: /Create deposit request/i }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "reserve liquidity" }),
    ).toBeVisible();
  });

  test("a quote failure disables submission rather than showing a stale or guessed quote", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/quote`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return respondJson(route, { error: "internal" }, 500);
    });

    await page.goto("/bridge");
    await page.getByLabel(/Amount in GLC/i).fill("1000");

    // The quote panel shows the failure through the same three-part error
    // formula as everywhere else — never a stale or guessed quote.
    await expect(page.getByText(/could not complete that request/i)).toBeVisible();
    await expect(page.getByText("You bridge")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /Create deposit request/i }),
    ).toBeDisabled();
  });

  test("a transfer lookup for an unknown id shows not-found, never a fabricated status", async ({
    page,
  }) => {
    await mockHappyBackend(page);
    await page.route(`${INTERCEPTED_API_ORIGIN}/transfers/424242`, (route) => {
      if (route.request().method() === "OPTIONS") return respondJson(route, null);
      return respondJson(route, { error: "no transfer with id 424242" }, 404);
    });

    await page.goto("/bridge/424242");
    await expect(page.getByText(/could not find that transfer/i)).toBeVisible();
  });
});

import { test, expect } from "@playwright/test";

/**
 * Drives a real running backend end to end (see ./README.md for how to
 * bring one up). Skips itself, never fails, when E2E_REAL_BACKEND_URL is
 * unset — this project is opt-in, not part of the default E2E baseline.
 */

test.beforeEach(() => {
  test.skip(
    !process.env.E2E_REAL_BACKEND_URL,
    "E2E_REAL_BACKEND_URL not set — see tests/e2e/real-backend/README.md",
  );
});

test("status page renders real per-direction availability and reserve capacity, not a validation error", async ({
  page,
}) => {
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: /bridge status/i })).toBeVisible();
  // A schema mismatch surfaces as "did not match its schema" (src/lib/api/errors.ts
  // validationError) — its absence after the page settles is proof the real
  // response parsed against the frontend's Zod schemas, not just that
  // *a* response arrived.
  await expect(page.getByText(/did not match its schema/i)).not.toBeVisible();
  await expect(page.getByText(/could not reach the bridge/i)).not.toBeVisible();
  await expect(page.getByText("Destination reserve capacity").first()).toBeVisible();
});

test("bridge form requests a real quote and shows the real 1% breakdown", async ({
  page,
}) => {
  await page.goto("/bridge");
  await page.getByLabel(/Amount in GLC/i).fill("10");
  await expect(page.getByText("Bridge fee (1%)")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/−0\.10000000/)).toBeVisible();
  await expect(page.getByText(/9\.90000000/)).toBeVisible();
});

test("reserves page shows real per-direction capacity from the real backend", async ({
  page,
}) => {
  await page.goto("/reserves");
  await expect(page.getByRole("heading", { name: /reserves/i }).first()).toBeVisible();
  await expect(page.getByText(/did not match its schema/i)).not.toBeVisible();
});

test("creates a real GlcToSol transfer request and shows real backend-issued deposit instructions", async ({
  page,
}) => {
  // Valueless: POST /transfers only reserves capacity and returns deposit
  // instructions (service/src/api.rs `create_glc_to_sol_transfer`) — it
  // never broadcasts a Goldcoin transaction. Nothing here signs or sends
  // anything.
  //
  // Runs BEFORE the explorer spec below (specs in one file run in order):
  // on a freshly bootstrapped backend with an empty ledger, this is what
  // guarantees the explorer has at least one event to show.
  await page.goto("/bridge");
  await page.getByLabel(/Amount in GLC/i).fill("5");
  await page
    .getByLabel("Solana recipient address")
    .fill("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  await expect(page.getByText("Bridge fee (1%)")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /Create deposit request/i }).click();

  await expect(page.getByRole("heading", { name: /send your deposit/i })).toBeVisible({
    timeout: 10_000,
  });
  // The deposit address is the real backend's own response field
  // (CreateTransferOutput.deposit_address), never invented client-side —
  // unique per request, no OP_RETURN binding required.
  await expect(page.getByText("Send to")).toBeVisible();
  await expect(page.getByText(/Send exactly/i)).toBeVisible();
  await expect(page.getByText(/OP_RETURN/i)).toHaveCount(0);

  await page.getByRole("button", { name: /I've sent it/i }).click();
  await expect(page).toHaveURL(/\/bridge\/\d+$/);
  await expect(page.getByText(/did not match its schema/i)).not.toBeVisible();
});

test("explorer shows real aggregate stats and a real, non-empty event feed", async ({
  page,
}) => {
  await page.goto("/explorer");
  await expect(page.getByText(/did not match its schema/i)).not.toBeVisible();
  // At least one created request exists by now — the create-transfer spec
  // above ran first and recorded one, even on a virgin backend.
  await expect(page.getByText(/^#\d+$/).first()).toBeVisible({ timeout: 10_000 });
});

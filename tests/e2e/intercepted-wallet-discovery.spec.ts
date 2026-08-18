import { test, expect } from "@playwright/test";
import { mockHappyBackend } from "./intercepted-helpers";

/**
 * Wallet Standard discovery, end to end in a real browser.
 *
 * The injected wallet below is SYNTHETIC — a minimal but spec-compliant
 * Wallet Standard implementation registered exactly the way a real
 * extension's inpage script does it (the `wallet-standard:register-wallet`
 * / `wallet-standard:app-ready` event handshake), before any page script
 * runs. What this proves is OUR side of the contract: SolanaProvider
 * mounts, `useStandardWalletAdapters` listens, the handshake completes
 * under the production CSP, and the connect dialog reflects the detected
 * wallet. What it deliberately does NOT prove is any real extension's
 * behavior — Phantom, notably, refuses to inject on plain-http origins
 * other than localhost/127.0.0.1 (docs.phantom.com FAQ), which no
 * app-side test can detect. Real-extension verification is a manual step
 * over https.
 *
 * Lives in the intercepted project because that server is the one built
 * with NEXT_PUBLIC_SOLANA_RPC_URL set (see playwright.config.ts) — without
 * an RPC endpoint SolanaProvider intentionally never mounts WalletProvider
 * and there is no discovery to test.
 */

const SYNTHETIC_WALLET_STANDARD_WALLET = `
(() => {
  const wallet = {
    version: '1.0.0',
    name: 'Synthetic Standard Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',
    chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'],
    accounts: [],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [] }) },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: [0, 'legacy'],
        signAndSendTransaction: async () => { throw new Error('unsupported'); },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: [0, 'legacy'],
        signTransaction: async () => { throw new Error('unsupported'); },
      },
    },
  };
  const callback = (api) => { api.register(wallet); };
  window.addEventListener('wallet-standard:app-ready', (event) => callback(event.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: callback }));
})();
`;

test("a Wallet Standard wallet registered before page load is detected and listed", async ({
  page,
}) => {
  await mockHappyBackend(page);
  await page.addInitScript(SYNTHETIC_WALLET_STANDARD_WALLET);
  await page.goto("/bridge");

  await page.getByRole("button", { name: /connect wallet/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // The synthetic wallet appears as a detected entry…
  await expect(dialog.getByText("Synthetic Standard Wallet")).toBeVisible();
  await expect(dialog.getByText("Detected").first()).toBeVisible();
  // …ahead of the advertised-but-absent wallets, which keep install links.
  await expect(dialog.getByText("Phantom")).toBeVisible();
  await expect(dialog.getByText("Not installed").first()).toBeVisible();
});

test("with no wallet registered, every advertised wallet shows as not installed", async ({
  page,
}) => {
  await mockHappyBackend(page);
  await page.goto("/bridge");

  await page.getByRole("button", { name: /connect wallet/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Phantom")).toBeVisible();
  await expect(dialog.getByText("Solflare")).toBeVisible();
  await expect(dialog.getByText("Backpack")).toBeVisible();
  await expect(dialog.getByText("Detected")).toHaveCount(0);
});

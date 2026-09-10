import { test, expect } from "@playwright/test";
import { mockHappyBackend } from "./intercepted-helpers";
import { selectNetwork, waitForRouteVerdict } from "./network-selection.helpers";

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
 * The connect controls live in the bridge form's FROM panel and belong to
 * the selected source network, so every case below selects Solana first.
 * Only DETECTED wallets get a button there; how undetected ones are merged
 * into the list is covered by `tests/unit/solana-adapter-bridge.test.tsx`.
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

test("a Wallet Standard wallet registered before page load is detected and offered", async ({
  page,
}) => {
  await mockHappyBackend(page);
  await page.addInitScript(SYNTHETIC_WALLET_STANDARD_WALLET);
  await page.goto("/bridge");
  await waitForRouteVerdict(page);
  await selectNetwork(page, "Source network", /Solana/);

  const panel = page.getByRole("region", { name: "From" });
  await expect(
    panel.getByRole("button", { name: /Connect Synthetic Standard Wallet/i }),
  ).toBeVisible();
});

test("with no wallet registered, the panel says so instead of offering a dead button", async ({
  page,
}) => {
  await mockHappyBackend(page);
  await page.goto("/bridge");
  await waitForRouteVerdict(page);
  await selectNetwork(page, "Source network", /Solana/);

  const panel = page.getByRole("region", { name: "From" });
  await expect(panel.getByText(/No Solana wallet was detected/i)).toBeVisible();
  await expect(panel.getByRole("link", { name: /wallets we support/i })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Connect / })).toHaveCount(0);
});

test("a Robinhood source offers its own EVM wallets, not Solana's", async ({ page }) => {
  // The panel's contents follow the source network. Nothing about the
  // Solana wallet survives the switch.
  await mockHappyBackend(page);
  await page.addInitScript(SYNTHETIC_WALLET_STANDARD_WALLET);
  await page.goto("/bridge");
  await waitForRouteVerdict(page);
  await selectNetwork(page, "Source network", /Robinhood Chain/);

  const panel = page.getByRole("region", { name: "From" });
  await expect(
    panel.getByRole("button", { name: /Connect Synthetic Standard Wallet/i }),
  ).toHaveCount(0);
});

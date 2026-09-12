import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import type * as EvmModule from "@/lib/evm";
import { BridgeForm } from "@/features/bridge/BridgeForm";

/**
 * Wallet connection is contextual to the SOURCE network.
 *
 * There is no site-wide connect control any more, so the form's FROM panel
 * is the only place a wallet is offered — and which wallets it offers is
 * decided entirely by the network selected above them. The rule these
 * tests hold: the panel never offers a wallet that cannot fund the
 * selected network, and never offers a browser wallet for Goldcoin, which
 * is funded by sending to a deposit address the backend issues later.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    getSolToGlcRecipientEligibility: (...args: unknown[]) =>
      getSolToGlcRecipientEligibility(...args),
    // The one method `fetchRouteEligibility` calls. Built from the
    // per-route mocks above by the same rule `HttpBridgeClient` uses, so
    // a route with no landed endpoint rejects here exactly as it would
    // against the real backend.
    getRouteEligibility: routeEligibilityFrom({
      SolToGlc: (address: string, wallet: string | null) =>
        getSolToGlcRecipientEligibility(address, wallet),
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

/** Mutable Solana wallet state, driven per test. */
const solana = vi.hoisted(() => ({
  status: "disconnected" as "unconfigured" | "disconnected" | "connecting" | "connected",
  address: null as string | null,
  platform: "desktop" as "desktop" | "ios" | "unsupported-webview",
  wallets: [] as {
    id: string;
    name: string;
    iconUrl: string | null;
    installed: boolean;
    installUrl: string | null;
  }[],
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: solana.status,
    address: solana.address,
    wallet: null,
    wallets: solana.wallets,
    canSign: solana.status === "connected",
    error: null,
    platform: solana.platform,
    connect: solana.connect,
    disconnect: solana.disconnect,
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => false,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: (platform: string) => platform === "ios",
  isUserRejection: () => false,
  buildDeepLinks: () => [{ id: "phantom", name: "Phantom", url: "https://example.test" }],
}));

/** Mutable EVM wallet state, driven per test. */
const evm = vi.hoisted(() => ({
  wallets: [] as { uuid: string; name: string; icon: string | null }[],
  hasInjectedWallet: true,
  address: null as string | null,
  deployment: null as null | {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    bridgeAddress: string;
    tokenAddress: string;
  },
  connect: vi.fn(),
}));

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => evm.deployment,
    useEvmWallet: () => ({
      wallets: evm.wallets,
      hasInjectedWallet: evm.hasInjectedWallet,
      address: evm.address,
      chainId: evm.deployment?.chainId ?? null,
      connecting: false,
      deployment: evm.deployment,
      onExpectedChain: evm.address !== null,
      connect: evm.connect,
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: vi.fn() }),
    useRobinhoodGlcBalance: () => ({ isPending: false, isError: false, data: undefined }),
  };
});

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function solanaWallet(id: string, name: string, installed = true) {
  return { id, name, iconUrl: null, installed, installUrl: null };
}

/** The FROM panel, which is where every source-side control belongs. */
function fromPanel() {
  return within(screen.getByRole("region", { name: "From" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  solana.status = "disconnected";
  solana.address = null;
  solana.platform = "desktop";
  solana.wallets = [];
  evm.wallets = [];
  evm.hasInjectedWallet = true;
  evm.address = null;
  evm.deployment = null;

  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockRejectedValue(new Error("no quote is needed for these tests"));
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  getSolToGlcRecipientEligibility.mockResolvedValue({
    direction: "SolToGlc",
    address: "unused",
    wallet: null,
    eligible: true,
    blocked_reason: null,
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
});

describe("Robinhood source", () => {
  beforeEach(() => {
    evm.deployment = DEPLOYMENT;
    evm.wallets = [
      { uuid: "io.metamask", name: "MetaMask", icon: null },
      { uuid: "app.phantom", name: "Phantom", icon: null },
      { uuid: "com.okex.wallet", name: "OKX Wallet", icon: null },
    ];
  });

  it("still offers the injected EVM wallets, unchanged", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    const panel = fromPanel();
    expect(await panel.findByRole("button", { name: "Connect MetaMask" })).toBeVisible();
    expect(panel.getByRole("button", { name: "Connect Phantom" })).toBeVisible();
    expect(panel.getByRole("button", { name: "Connect OKX Wallet" })).toBeVisible();
  });

  it("connects the wallet that was pressed", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Robinhood Chain/);

    await user.click(
      await fromPanel().findByRole("button", { name: "Connect MetaMask" }),
    );
    expect(evm.connect).toHaveBeenCalledWith("io.metamask");
  });
});

describe("Solana source", () => {
  beforeEach(() => {
    solana.wallets = [
      solanaWallet("phantom", "Phantom"),
      solanaWallet("solflare", "Solflare"),
      // Advertised but absent: a button here could not connect anything.
      solanaWallet("backpack", "Backpack", false),
    ];
  });

  it("offers a connect button for each detected Solana wallet", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    const panel = fromPanel();
    expect(await panel.findByRole("button", { name: "Connect Phantom" })).toBeVisible();
    expect(panel.getByRole("button", { name: "Connect Solflare" })).toBeVisible();
    expect(panel.queryByRole("button", { name: /Backpack/ })).toBeNull();
  });

  it("connects the wallet that was pressed", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    await user.click(
      await fromPanel().findByRole("button", { name: "Connect Solflare" }),
    );
    expect(solana.connect).toHaveBeenCalledWith("solflare");
  });

  it("says so plainly when no Solana wallet is detected", async () => {
    // Never a dead button: an unusable control with no account of why is
    // the failure mode this form is written against.
    solana.wallets = [solanaWallet("phantom", "Phantom", false)];
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    const panel = fromPanel();
    expect(await panel.findByText(/No Solana wallet was detected/i)).toBeVisible();
    expect(panel.queryByRole("button", { name: /^Connect / })).toBeNull();
  });

  it("shows the connected address with a way to disconnect", async () => {
    solana.status = "connected";
    solana.address = SOLANA_ADDRESS;
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    const panel = fromPanel();
    expect(await panel.findByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(panel.queryByRole("button", { name: /^Connect / })).toBeNull();

    await user.click(panel.getByRole("button", { name: "Disconnect" }));
    expect(solana.disconnect).toHaveBeenCalled();
  });

  it("offers the deep-link route on iOS, where nothing can inject", async () => {
    solana.platform = "ios";
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    expect(await fromPanel().findByText(/Open in your wallet app/i)).toBeVisible();
  });

  it("states the deployment is unconfigured rather than offering a dead button", async () => {
    solana.status = "unconfigured";
    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();
    await selectNetwork(user, "Source network", /Solana/);

    const panel = fromPanel();
    expect(await panel.findByText(/not configured for this deployment/i)).toBeVisible();
    expect(panel.queryByRole("button", { name: /^Connect / })).toBeNull();
  });
});

describe("Goldcoin source", () => {
  it("offers no browser wallet at all", async () => {
    // Goldcoin is funded by sending to a deposit address the backend issues
    // after the request is created. There is nothing to connect beforehand,
    // and a connect button here would imply otherwise.
    solana.wallets = [solanaWallet("phantom", "Phantom")];
    evm.deployment = DEPLOYMENT;
    evm.wallets = [{ uuid: "io.metamask", name: "MetaMask", icon: null }];

    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    // Goldcoin is the default source.
    const panel = fromPanel();
    await waitFor(() =>
      expect(panel.queryByRole("button", { name: /^Connect / })).toBeNull(),
    );
    expect(panel.queryByText(/No Solana wallet was detected/i)).toBeNull();
    expect(panel.queryByText(/Open in your wallet app/i)).toBeNull();
  });
});

describe("switching source networks", () => {
  it("swaps one network's wallets for the other's, never showing both", async () => {
    solana.wallets = [solanaWallet("phantom", "Phantom")];
    evm.deployment = DEPLOYMENT;
    evm.wallets = [{ uuid: "io.metamask", name: "MetaMask", icon: null }];

    const user = userEvent.setup();
    renderWithQueryClient(<BridgeForm />);
    await waitForRouteVerdict();

    await selectNetwork(user, "Source network", /Robinhood Chain/);
    expect(
      await fromPanel().findByRole("button", { name: "Connect MetaMask" }),
    ).toBeVisible();
    expect(fromPanel().queryByRole("button", { name: "Connect Phantom" })).toBeNull();

    await selectNetwork(user, "Source network", /Solana/);
    expect(
      await fromPanel().findByRole("button", { name: "Connect Phantom" }),
    ).toBeVisible();
    expect(fromPanel().queryByRole("button", { name: "Connect MetaMask" })).toBeNull();
  });
});

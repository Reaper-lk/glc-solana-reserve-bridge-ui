import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Component, type ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { numberToHex } from "viem";
import {
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
  waitForRouteVerdict,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * The Robinhood source balance, end to end through the real EVM stack.
 *
 * `@/lib/evm` is NOT mocked here: an injected EIP-6963 wallet is announced
 * to the real discovery code, and its `request` is the only chain access in
 * the test. That is the whole point of the file — the previous
 * implementation read the balance over `NEXT_PUBLIC_ROBINHOOD_RPC_URL`, so
 * a wallet that answered every request perfectly still produced "Balance
 * unavailable" in production. If that regresses, no `eth_call` reaches the
 * provider here and these assertions fail.
 *
 * The second rule this file holds: a failed balance read is a LOCAL state.
 * It renders as "Balance unavailable" beside the amount field and never
 * reaches the page-level error boundary, whose copy ("Something went wrong
 * loading this page.") would replace a working bridge form over a figure
 * the form is perfectly able to do without.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID = "4663";
  process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_NAME = "Robinhood Chain";
  process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL = "https://rpc.example.invalid";
  // The PINNED V2 contract. Configuration is checked against it rather
  // than believed, so any other address fails the deployment closed —
  // which is what a fixture naming an arbitrary contract used to do
  // silently.
  process.env.NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS =
    "0xbaEdFFdAC19fC9c1F025f8F6F74e633aB2708DBf";
  process.env.NEXT_PUBLIC_ROBINHOOD_TOKEN_ADDRESS =
    "0xaf0172DDEa4ce60dB3EBab05748A00B14fC8e433";
});

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...a: unknown[]) => getStatus(...a),
    getChains: (...a: unknown[]) => getChains(...a),
    getLimits: (...a: unknown[]) => getLimits(...a),
    getReserve: (...a: unknown[]) => getReserve(...a),
    getQuote: (...a: unknown[]) => getQuote(...a),
    createTransfer: vi.fn(),
    listTransfers: (...a: unknown[]) => listTransfers(...a),
    getSolToGlcRecipientEligibility: (...a: unknown[]) =>
      getSolToGlcRecipientEligibility(...a),
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "disconnected" as const,
    address: null,
    wallet: null,
    wallets: [],
    canSign: false,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: () => ({ available: true, reason: null, message: null }),
    deposit: vi.fn(),
  }),
  isValidAddress: (v: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v),
  useTokenBalance: () => ({ isPending: false, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
}));

const { BridgeForm } = await import("@/features/bridge/BridgeForm");

const EVM_ADDRESS = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
/** 4663, the Robinhood Chain id, as `eth_chainId` answers it. */
const CHAIN_4663 = "0x1237";
/** 12,450.32 GLC at 18 decimals. Far past what a double holds exactly. */
const BALANCE_RAW = 12_450_320_000_000_000_000_000n;

/** An ABI-encoded 32-byte word, as a real `eth_call` result would be. */
function word(value: bigint | number): string {
  return numberToHex(value, { size: 32 });
}

/**
 * A page-level boundary standing in for `app/error.tsx`. If anything in the
 * form throws during render, this catches it — which is exactly the failure
 * mode that produces the generic red panel in production.
 */
class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return <div data-testid="page-error">Something went wrong loading this page.</div>;
    }
    return this.props.children;
  }
}

/** One EIP-1193 `request` call, as recorded by the stub. */
interface RecordedCall {
  readonly method: string;
  readonly params?: readonly { readonly data?: string }[];
}

type ProviderStub = {
  request: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

/** The `request` arguments the stub saw, in order. */
function callsOf(provider: ProviderStub): RecordedCall[] {
  return provider.request.mock.calls.map((call) => call[0] as RecordedCall);
}

/** The calldata of every `eth_call` the stub saw. */
function callDataOf(provider: ProviderStub): string[] {
  return callsOf(provider)
    .filter((call) => call.method === "eth_call")
    .map((call) => call.params?.[0]?.data ?? "");
}

let announce: ((event: Event) => void) | null = null;

/**
 * Announces one injected wallet to the real EIP-6963 discovery code.
 *
 * `onCall` answers `eth_call`; returning `null` from it means "this read
 * fails", which is how the provider-failure cases are driven.
 */
function installWallet(options: {
  chainIdHex?: string;
  accounts?: string[];
  onCall?: (data: string) => string | null;
}): ProviderStub {
  const {
    chainIdHex = CHAIN_4663,
    accounts = [EVM_ADDRESS],
    onCall = (data) => (data.startsWith("0x313ce567") ? word(18) : word(BALANCE_RAW)),
  } = options;

  const provider: ProviderStub = {
    request: vi.fn(async (args: { method: string; params?: unknown[] }) => {
      switch (args.method) {
        case "eth_chainId":
          return chainIdHex;
        case "eth_accounts":
        case "eth_requestAccounts":
          return accounts;
        case "eth_call": {
          const [call] = (args.params ?? []) as [{ data?: string } | undefined];
          const result = onCall(call?.data ?? "0x");
          if (result === null) throw new Error("the wallet could not reach the network");
          return result;
        }
        default:
          throw new Error(`unexpected ${args.method}`);
      }
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  };

  announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "robinhood-wallet",
            rdns: "com.robinhood.wallet",
            name: "Robinhood Wallet",
            icon: "",
          },
          provider,
        },
      }),
    );
  };
  window.addEventListener("eip6963:requestProvider", announce);
  return provider;
}

/** `decimals()`'s selector, for telling the two reads apart. */
const DECIMALS_SELECTOR = "0x313ce567";

async function robinhoodSource(user: ReturnType<typeof userEvent.setup>) {
  await waitForRouteVerdict();
  await selectNetwork(user, "Source network", /Robinhood/);
}

beforeEach(() => {
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(
    fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true }),
  );
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockResolvedValue({
    direction: "RhnToGlc",
    gross_amount: "100000000000",
    gross_display_amount: "1000.00000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "97000000000",
    net_display_amount: "970.00000000",
    source_decimals: 18,
    destination_decimals: 8,
    source_asset: "GLC (Robinhood)",
    destination_asset: "GLC (Goldcoin)",
  });
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1 });
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

afterEach(() => {
  if (announce) window.removeEventListener("eip6963:requestProvider", announce);
  announce = null;
  vi.clearAllMocks();
});

describe("Robinhood source balance", () => {
  it("reads balanceOf and decimals over the connected wallet's provider", async () => {
    const provider = installWallet({});
    const user = userEvent.setup();
    renderWithQueryClient(
      <PageBoundary>
        <BridgeForm />
      </PageBoundary>,
    );
    await robinhoodSource(user);

    expect(await screen.findByText(/12,450\.32 GLC/)).toBeVisible();

    expect(callsOf(provider).map((call) => call.method)).toContain("eth_call");

    const datas = callDataOf(provider);
    expect(datas.some((data) => data.startsWith(DECIMALS_SELECTOR))).toBe(true);
    expect(datas.some((data) => !data.startsWith(DECIMALS_SELECTOR))).toBe(true);
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("says unavailable — and does not crash the page — when the provider fails", async () => {
    installWallet({ onCall: () => null });
    const user = userEvent.setup();
    renderWithQueryClient(
      <PageBoundary>
        <BridgeForm />
      </PageBoundary>,
    );
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    // Never zero: "you hold none" is a different fact from "we could not ask".
    expect(screen.queryByText(/Balance: 0/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MAX" })).toBeDisabled();
    expect(screen.queryByTestId("page-error")).toBeNull();
    expect(
      screen.queryByText(/Something went wrong loading this page/i),
    ).not.toBeInTheDocument();
  });

  it("says unavailable — and reads nothing — while the wallet is on another chain", async () => {
    const provider = installWallet({ chainIdHex: "0x1" });
    const user = userEvent.setup();
    renderWithQueryClient(
      <PageBoundary>
        <BridgeForm />
      </PageBoundary>,
    );
    await robinhoodSource(user);

    expect(await screen.findByText("Balance unavailable")).toBeVisible();
    expect(callsOf(provider).map((call) => call.method)).not.toContain("eth_call");
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("shows no balance row at all while no wallet is connected", async () => {
    installWallet({ accounts: [] });
    const user = userEvent.setup();
    renderWithQueryClient(
      <PageBoundary>
        <BridgeForm />
      </PageBoundary>,
    );
    await robinhoodSource(user);

    await screen.findByRole("button", { name: /Connect Robinhood Wallet/i });
    expect(screen.queryByText(/Balance/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "MAX" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-error")).toBeNull();
  });

  it("drops the balance when the wallet is forgotten", async () => {
    installWallet({});
    const user = userEvent.setup();
    renderWithQueryClient(
      <PageBoundary>
        <BridgeForm />
      </PageBoundary>,
    );
    await robinhoodSource(user);
    expect(await screen.findByText(/12,450\.32 GLC/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: /Forget/i }));

    await waitFor(() =>
      expect(screen.queryByText(/12,450\.32 GLC/)).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("page-error")).toBeNull();
  });
});

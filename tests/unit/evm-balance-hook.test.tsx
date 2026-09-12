import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Address, EIP1193Provider } from "viem";
import {
  evmWalletQueryKeys,
  useRobinhoodGlcBalance,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GLC_TOKEN_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
  type EvmWalletState,
} from "@/lib/evm";

/**
 * `useRobinhoodGlcBalance`'s refusals.
 *
 * Each `enabled` clause is a real refusal rather than a loading state, and
 * this file pins the difference. The rule underneath all of them: this hook
 * never produces a figure it cannot stand behind, and never carries one
 * across a change of account, chain or wallet.
 */

const fetchRobinhoodGlcBalance = vi.fn();

vi.mock("@/lib/evm/balance", () => ({
  fetchRobinhoodGlcBalance: (...args: unknown[]) => fetchRobinhoodGlcBalance(...args),
}));

const DEPLOYMENT = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  // The pinned production target. A fixture naming anything else is
  // refused before any read is attempted.
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS as Address,
  tokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS as Address,
};

/**
 * The network identity — always resolvable, and what the wallet control
 * reads. Separate from the deposit deployment on purpose: connecting a
 * wallet touches no contract.
 */
const NETWORK = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: DEPLOYMENT.chainName,
  rpcUrl: DEPLOYMENT.rpcUrl,
} as const;

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as Address;

const PROVIDER = { request: vi.fn() } as unknown as EIP1193Provider;

function wallet(overrides: Partial<EvmWalletState> = {}): EvmWalletState {
  return {
    wallets: [],
    hasInjectedWallet: true,
    address: ACCOUNT,
    chainId: DEPLOYMENT.chainId,
    connecting: false,
    network: NETWORK,
    deployment: DEPLOYMENT,
    onExpectedChain: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchChain: vi.fn(),
    getProvider: () => PROVIDER,
    ...overrides,
  };
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchRobinhoodGlcBalance.mockResolvedValue({
    raw: "1000000000000000000",
    decimals: 18,
    symbol: "GLC",
  });
});

describe("useRobinhoodGlcBalance", () => {
  it("reads the balance through the wallet's own provider", async () => {
    const { result } = renderHook(() => useRobinhoodGlcBalance(wallet()), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      raw: "1000000000000000000",
      decimals: 18,
      symbol: "GLC",
    });
    // No deployment passed: the token and the chain are pinned, so a
    // balance never depends on env-supplied addresses.
    expect(fetchRobinhoodGlcBalance).toHaveBeenCalledWith({
      account: ACCOUNT,
      provider: PROVIDER,
    });
  });

  it("attempts nothing while no wallet is connected", async () => {
    const { result } = renderHook(
      () => useRobinhoodGlcBalance(wallet({ address: null })),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetchRobinhoodGlcBalance).not.toHaveBeenCalled();
  });

  it("attempts nothing while the wallet is on another chain", async () => {
    const { result } = renderHook(
      () => useRobinhoodGlcBalance(wallet({ chainId: 1, onExpectedChain: false })),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetchRobinhoodGlcBalance).not.toHaveBeenCalled();
  });

  it("attempts nothing without a configured deployment", async () => {
    const { result } = renderHook(
      () => useRobinhoodGlcBalance(wallet({ deployment: null, onExpectedChain: false })),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetchRobinhoodGlcBalance).not.toHaveBeenCalled();
  });

  it("errors rather than falling back when the provider has gone away", async () => {
    // The wallet was forgotten between the render that enabled the query
    // and the query running. Never `window.ethereum` as a substitute: that
    // may be a different extension entirely.
    const { result } = renderHook(
      () => useRobinhoodGlcBalance(wallet({ getProvider: () => null })),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchRobinhoodGlcBalance).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("reports a failed read as an error and no data", async () => {
    fetchRobinhoodGlcBalance.mockRejectedValue(new Error("wallet is locked"));
    const { result } = renderHook(() => useRobinhoodGlcBalance(wallet()), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("never carries a balance across accounts or chains", () => {
    const forAccount = evmWalletQueryKeys.glcBalance(4663, ACCOUNT);
    const otherAccount = evmWalletQueryKeys.glcBalance(
      4663,
      "0x0000000000000000000000000000000000000001",
    );
    const otherChain = evmWalletQueryKeys.glcBalance(1, ACCOUNT);

    expect(forAccount).not.toEqual(otherAccount);
    expect(forAccount).not.toEqual(otherChain);
    // Neither the deployment's RPC URL nor its token is part of the key:
    // the read goes over the wallet's provider to a pinned token, so
    // neither can alter the answer and keying on them would invent cache
    // misses for changes that cannot.
    expect(forAccount).not.toContain(DEPLOYMENT.rpcUrl);
    expect(forAccount).not.toContain(DEPLOYMENT.tokenAddress);
  });

  it("reads the balance with NO deposit deployment resolved at all", () => {
    // The production shape this fix is for: a deployment refused for a
    // stale or absent token variable used to remove the balance and the
    // MAX button, though neither involves the bridge contract.
    const { result } = renderHook(
      () => useRobinhoodGlcBalance(wallet({ deployment: null })),
      { wrapper: wrapper() },
    );
    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).not.toBe("idle");
  });
});

/**
 * The refresh triggers.
 *
 * Three of the four fall out of the query KEY — a wallet connecting, an
 * account switching and a network switching all change `(chainId,
 * account)`, so each is a cache miss rather than a stale figure carried
 * across it. The fourth, a successful deposit, is an explicit
 * invalidation, and it works by PREFIX: `BridgeForm.refreshSourceBalance`
 * invalidates `evmWalletQueryKeys.balances()` without knowing which
 * account or chain is in play.
 */
describe("evmWalletQueryKeys.glcBalance — refresh triggers", () => {
  const prefix = evmWalletQueryKeys.balances();

  it("sits under the prefix a successful deposit invalidates", () => {
    const key = evmWalletQueryKeys.glcBalance(4663, ACCOUNT);
    expect(key.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it("changes when a wallet connects", () => {
    // Disconnected to connected: from no account to one.
    expect(evmWalletQueryKeys.glcBalance(4663, null)).not.toEqual(
      evmWalletQueryKeys.glcBalance(4663, ACCOUNT),
    );
  });

  it("changes when the ACCOUNT changes inside one wallet", () => {
    expect(evmWalletQueryKeys.glcBalance(4663, ACCOUNT)).not.toEqual(
      evmWalletQueryKeys.glcBalance(4663, "0x0000000000000000000000000000000000000002"),
    );
  });

  it("changes when the NETWORK changes under one account", () => {
    expect(evmWalletQueryKeys.glcBalance(4663, ACCOUNT)).not.toEqual(
      evmWalletQueryKeys.glcBalance(1, ACCOUNT),
    );
  });
});

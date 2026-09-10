import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Address, EIP1193Provider } from "viem";
import {
  evmWalletQueryKeys,
  useRobinhoodGlcBalance,
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
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as Address,
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359" as Address,
};

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as Address;

const PROVIDER = { request: vi.fn() } as unknown as EIP1193Provider;

function wallet(overrides: Partial<EvmWalletState> = {}): EvmWalletState {
  return {
    wallets: [],
    hasInjectedWallet: true,
    address: ACCOUNT,
    chainId: DEPLOYMENT.chainId,
    connecting: false,
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
    expect(fetchRobinhoodGlcBalance).toHaveBeenCalledWith({
      deployment: DEPLOYMENT,
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
    const forAccount = evmWalletQueryKeys.glcBalance(DEPLOYMENT, 4663, ACCOUNT);
    const otherAccount = evmWalletQueryKeys.glcBalance(
      DEPLOYMENT,
      4663,
      "0x0000000000000000000000000000000000000001",
    );
    const otherChain = evmWalletQueryKeys.glcBalance(DEPLOYMENT, 1, ACCOUNT);

    expect(forAccount).not.toEqual(otherAccount);
    expect(forAccount).not.toEqual(otherChain);
    // The read no longer depends on the deployment's RPC URL, so it is not
    // part of the identity of the answer.
    expect(forAccount).not.toContain(DEPLOYMENT.rpcUrl);
  });
});

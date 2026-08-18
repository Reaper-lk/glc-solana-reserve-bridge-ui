import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const walletState = {
  publicKey: null as null | { toBase58: () => string },
  sendTransaction: vi.fn(),
  signTransaction: undefined as undefined | (() => void),
  connected: false,
};

const connectionState = { connection: {} as unknown };

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => connectionState,
  useWallet: () => walletState,
}));

const runtimeState = { configured: true };
vi.mock("@/lib/solana/adapter/provider", () => ({
  useWalletRuntime: () => runtimeState,
}));

import { useDepositToReserve } from "@/lib/solana/send";

beforeEach(() => {
  vi.clearAllMocks();
  walletState.publicKey = null;
  walletState.signTransaction = undefined;
  walletState.connected = false;
  runtimeState.configured = true;
});

describe("useDepositToReserve — capability", () => {
  it("reports rpc-unconfigured when no RPC endpoint is set", () => {
    runtimeState.configured = false;
    const { result } = renderHook(() => useDepositToReserve());
    expect(result.current.capability(10).reason).toBe("rpc-unconfigured");
  });

  it("stays rpc-unconfigured regardless of wallet connection state in this environment", () => {
    // NEXT_PUBLIC_SOLANA_RPC_URL is never set in tests, so capability()'s
    // own walletConfigured check (Boolean(env.solanaRpcUrl)) short-circuits
    // before it ever reaches the wallet-disconnected/program-unconfigured
    // branches — those are exercised directly against getDepositCapability
    // in solana-deposit.test.ts. This asserts the hook still derives
    // connected/canSign from the adapter without throwing either way.
    walletState.connected = true;
    walletState.signTransaction = () => undefined;
    const { result } = renderHook(() => useDepositToReserve());
    expect(result.current.capability(10).reason).toBe("rpc-unconfigured");
  });

  it("never throws when reading capability with an unmounted/unconfigured runtime", () => {
    runtimeState.configured = false;
    const { result } = renderHook(() => useDepositToReserve());
    expect(() => result.current.capability(10)).not.toThrow();
  });
});

describe("useDepositToReserve — deposit", () => {
  it("rejects when the wallet is not ready/connected", async () => {
    const { result } = renderHook(() => useDepositToReserve());
    await expect(
      result.current.deposit({
        amountAtomic: 1n,
        goldcoinAddress: "abc",
        obligationIndex: 0,
      }),
    ).rejects.toThrow(/not connected/i);
  });

  it("rejects when the reserve program id is not configured, even with a connected wallet", async () => {
    walletState.connected = true;
    walletState.publicKey = {
      toBase58: () => "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    };
    const { result } = renderHook(() => useDepositToReserve());
    await expect(
      result.current.deposit({
        amountAtomic: 1n,
        goldcoinAddress: "abc",
        obligationIndex: 0,
      }),
    ).rejects.toThrow(/program id is not configured/i);
  });
});

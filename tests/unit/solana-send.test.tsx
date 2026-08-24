import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import type * as DepositModule from "@/lib/solana/deposit";

const walletState = {
  publicKey: null as null | PublicKey,
  sendTransaction: vi.fn(),
  signTransaction: undefined as undefined | (() => void),
  connected: false,
};

const getLatestBlockhash = vi.fn();
const confirmTransaction = vi.fn();
const connectionState = {
  connection: { getLatestBlockhash, confirmTransaction } as unknown,
};

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => connectionState,
  useWallet: () => walletState,
}));

const runtimeState = { configured: true };
vi.mock("@/lib/solana/adapter/provider", () => ({
  useWalletRuntime: () => runtimeState,
}));

const envState = vi.hoisted(() => ({
  solanaRpcUrl: undefined as string | undefined,
  reserveProgramId: undefined as string | undefined,
  reserveMintAddress: "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump",
}));
vi.mock("@/lib/config/env", () => ({ env: envState }));

// `buildDepositToReserveInstruction` does real ed25519 on-curve PDA
// derivation (`PublicKey.findProgramAddressSync`), which spuriously fails
// under this file's jsdom environment (a documented web3.js/jsdom
// incompatibility — see solana-deposit.test.ts's own `@vitest-environment
// node` workaround, which this file cannot use alongside `renderHook`).
// These tests are about `send.ts`'s connection/wallet/error-handling
// behavior, not instruction-building (already covered under `node` in
// solana-deposit.test.ts), so the real builder is swapped for a minimal
// stand-in; `attachRecentBlockhash` — the function actually under test —
// stays real.
vi.mock("@/lib/solana/deposit", async (importOriginal) => {
  const actual = await importOriginal<typeof DepositModule>();
  return {
    ...actual,
    buildDepositToReserveInstruction: vi.fn(() => ({
      programId: new PublicKey("11111111111111111111111111111111"),
      keys: [],
      data: Buffer.from([]),
    })),
  };
});

import { isApiError } from "@/lib/api/errors";
import { useDepositToReserve } from "@/lib/solana/send";

const CONNECTED_PUBLIC_KEY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const RESERVE_PROGRAM_ID = "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY";

beforeEach(() => {
  vi.clearAllMocks();
  walletState.publicKey = null;
  walletState.signTransaction = undefined;
  walletState.connected = false;
  runtimeState.configured = true;
  envState.solanaRpcUrl = undefined;
  envState.reserveProgramId = undefined;
  getLatestBlockhash.mockResolvedValue({ blockhash: "abc", lastValidBlockHeight: 100 });
  confirmTransaction.mockResolvedValue({ value: { err: null } });
});

/** Connects the wallet and configures the reserve program, so `deposit()` reaches the send/confirm calls under test rather than an earlier guard clause. */
function connectAndConfigure() {
  walletState.connected = true;
  walletState.publicKey = new PublicKey(CONNECTED_PUBLIC_KEY);
  envState.reserveProgramId = RESERVE_PROGRAM_ID;
}

const DEPOSIT_PARAMS = {
  amountAtomic: 1n,
  goldcoinAddress: "MzDXwBbmkg8ZTbNMqU",
  obligationIndex: 0,
};

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
    walletState.publicKey = new PublicKey(CONNECTED_PUBLIC_KEY);
    const { result } = renderHook(() => useDepositToReserve());
    await expect(
      result.current.deposit({
        amountAtomic: 1n,
        goldcoinAddress: "abc",
        obligationIndex: 0,
      }),
    ).rejects.toThrow(/program id is not configured/i);
  });

  it("fetches the blockhash once and reuses it, unchanged, to confirm the transaction it was signed with", async () => {
    connectAndConfigure();
    walletState.sendTransaction.mockImplementation(
      async (transaction: { recentBlockhash?: string }) => {
        // The blockhash must already be on the transaction BEFORE it is
        // handed to the wallet to sign and send — not fetched afterward.
        expect(transaction.recentBlockhash).toBe("abc");
        return "sig-1";
      },
    );

    const { result } = renderHook(() => useDepositToReserve());
    const deposit = await result.current.deposit(DEPOSIT_PARAMS);

    expect(deposit.signature).toBe("sig-1");
    expect(getLatestBlockhash).toHaveBeenCalledTimes(1);
    expect(confirmTransaction).toHaveBeenCalledTimes(1);
    // The exact blockhash/lastValidBlockHeight fetched before sending —
    // never a second, later one fetched after the transaction was already
    // broadcast and signed against the first.
    expect(confirmTransaction).toHaveBeenCalledWith(
      { signature: "sig-1", blockhash: "abc", lastValidBlockHeight: 100 },
      "confirmed",
    );
  });

  it("wraps a sendTransaction failure as a transaction-specific, safe-funds error", async () => {
    connectAndConfigure();
    walletState.sendTransaction.mockRejectedValue(new Error("403: Forbidden"));

    const { result } = renderHook(() => useDepositToReserve());
    let thrown: unknown;
    try {
      await result.current.deposit(DEPOSIT_PARAMS);
    } catch (error) {
      thrown = error;
    }

    expect(isApiError(thrown)).toBe(true);
    if (isApiError(thrown)) {
      expect(thrown.presentation.what).toBe(
        "The Solana transaction could not be submitted.",
      );
      expect(thrown.presentation.funds).toMatch(/no funds have left your wallet/i);
      expect(thrown.presentation.next).toContain("403: Forbidden");
    }
    // A send failure never reaches confirmation — there is no signature to confirm.
    expect(confirmTransaction).not.toHaveBeenCalled();
  });

  it("wraps a confirmTransaction failure distinctly, without claiming funds are safe", async () => {
    connectAndConfigure();
    walletState.sendTransaction.mockResolvedValue("sig-2");
    confirmTransaction.mockRejectedValue(new Error("block height exceeded"));

    const { result } = renderHook(() => useDepositToReserve());
    let thrown: unknown;
    try {
      await result.current.deposit(DEPOSIT_PARAMS);
    } catch (error) {
      thrown = error;
    }

    expect(isApiError(thrown)).toBe(true);
    if (isApiError(thrown)) {
      expect(thrown.presentation.what).toMatch(/submitted, but its confirmation/i);
      expect(thrown.presentation.funds).toContain("sig-2");
      expect(thrown.presentation.next).toContain("block height exceeded");
    }
  });
});

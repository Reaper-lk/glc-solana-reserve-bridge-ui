"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { env } from "@/lib/config/env";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useWalletRuntime } from "./adapter/provider";
import { buildDepositToReserveInstruction, isDepositProgramConfigured } from "./deposit";
import { getDepositCapability, type DepositCapability } from "./deposit";

/**
 * The one function outside `getDepositCapability` that crosses the
 * wallet-adapter/web3.js boundary for the Solana -> Goldcoin direction. It
 * takes and returns only plain strings/numbers — the caller in
 * `src/features/bridge` never sees a `PublicKey` or `Transaction`.
 *
 * `useWallet()`'s default (no-`WalletProvider`-mounted) context throws the
 * moment `publicKey`/`wallet`/`wallets` is read — the same reason
 * `adapter/bridge.ts` guards every field behind a `ready` check — so this
 * hook must do the same rather than destructuring those fields directly.
 * `SolanaProvider` only mounts a real `WalletProvider` when
 * `NEXT_PUBLIC_SOLANA_RPC_URL` is set, and an unconfigured deployment is a
 * legitimate, supported state elsewhere in this app; this hook must not
 * crash the whole bridge form in that state.
 */
export interface DepositResult {
  readonly signature: string;
}

export interface DepositParams {
  readonly amountAtomic: bigint;
  readonly goldcoinAddress: string;
  readonly obligationIndex: number;
}

export function useDepositToReserve(): {
  readonly capability: (goldcoinAddressLength: number) => DepositCapability;
  readonly deposit: (params: DepositParams) => Promise<DepositResult>;
} {
  const { connection } = useConnection();
  const adapter = useWallet();
  const { configured } = useWalletRuntime();
  const mounted = useIsMounted();
  const ready = configured && mounted;

  const connected = ready && adapter.connected;
  const canSign = ready && adapter.connected && Boolean(adapter.signTransaction);

  const capability = useCallback(
    (goldcoinAddressLength: number): DepositCapability =>
      getDepositCapability({
        walletConfigured: Boolean(env.solanaRpcUrl),
        programConfigured: isDepositProgramConfigured(),
        walletConnected: connected,
        canSign,
        glcAddressBytesLength: goldcoinAddressLength,
      }),
    [connected, canSign],
  );

  const deposit = useCallback(
    async (params: DepositParams): Promise<DepositResult> => {
      if (!ready || !adapter.publicKey) throw new Error("Wallet is not connected");
      if (!env.reserveProgramId) throw new Error("Reserve program id is not configured");

      const publicKey = adapter.publicKey;
      const programId = new PublicKey(env.reserveProgramId);
      const reserveMint = new PublicKey(env.reserveMintAddress);

      const instruction = buildDepositToReserveInstruction({
        programId,
        user: publicKey,
        reserveMint,
        obligationIndex: params.obligationIndex,
        amountAtomic: params.amountAtomic,
        goldcoinAddress: params.goldcoinAddress,
      });

      const transaction = new Transaction().add(instruction);
      const signature = await adapter.sendTransaction(transaction, connection);
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");

      return { signature };
    },
    [ready, adapter, connection],
  );

  return { capability, deposit };
}

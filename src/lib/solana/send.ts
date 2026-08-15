"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { env } from "@/lib/config/env";
import { buildDepositToReserveInstruction, isDepositProgramConfigured } from "./deposit";
import { getDepositCapability, type DepositCapability } from "./deposit";

/**
 * The one function outside `getDepositCapability` that crosses the
 * wallet-adapter/web3.js boundary for the Solana -> Goldcoin direction. It
 * takes and returns only plain strings/numbers — the caller in
 * `src/features/bridge` never sees a `PublicKey` or `Transaction`.
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
  const { publicKey, sendTransaction, connected, signTransaction } = useWallet();

  const capability = useCallback(
    (goldcoinAddressLength: number): DepositCapability =>
      getDepositCapability({
        walletConfigured: Boolean(env.solanaRpcUrl),
        programConfigured: isDepositProgramConfigured(),
        walletConnected: connected,
        canSign: Boolean(connected && signTransaction),
        glcAddressBytesLength: goldcoinAddressLength,
      }),
    [connected, signTransaction],
  );

  const deposit = useCallback(
    async (params: DepositParams): Promise<DepositResult> => {
      if (!publicKey) throw new Error("Wallet is not connected");
      if (!env.reserveProgramId) throw new Error("Reserve program id is not configured");

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
      const signature = await sendTransaction(transaction, connection);
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction({ signature, ...latest }, "confirmed");

      return { signature };
    },
    [publicKey, sendTransaction, connection],
  );

  return { capability, deposit };
}

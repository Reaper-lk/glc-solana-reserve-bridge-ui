"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  solanaConfirmationError,
  solanaPreflightError,
  solanaSendError,
} from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { useWalletRuntime } from "./adapter/provider";
import {
  attachRecentBlockhash,
  buildDepositToReserveInstruction,
  isDepositProgramConfigured,
} from "./deposit";
import { getDepositCapability, type DepositCapability } from "./deposit";
import { describeRejection, simulateDeposit } from "./simulate";

/**
 * The one function outside `getDepositCapability` that crosses the
 * wallet-adapter/web3.js boundary for a Solana-SOURCED deposit — the source
 * leg of both `SolToGlc` and `SolToRhn`. It takes and returns only plain
 * strings/numbers — the caller in `src/features/bridge` never sees a
 * `PublicKey` or `Transaction`.
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
  /**
   * The opaque destination payload, as text: a Goldcoin address for
   * `SolToGlc`, a checksummed `0x…` EVM address for `SolToRhn`. The program
   * has no route field, so THESE BYTES are what select the route — the
   * backend classifies on the `0x` prefix — which is why the caller must
   * have encoded them for the route it intends
   * (`@/lib/bridge/solana-destination`).
   */
  readonly destination: string;
  readonly obligationIndex: number;
}

export function useDepositToReserve(): {
  readonly capability: (destinationByteLength: number) => DepositCapability;
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
    (destinationByteLength: number): DepositCapability =>
      getDepositCapability({
        walletConfigured: Boolean(env.solanaRpcUrl),
        programConfigured: isDepositProgramConfigured(),
        walletConnected: connected,
        canSign,
        glcAddressBytesLength: destinationByteLength,
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
        destination: params.destination,
      });

      const transaction = new Transaction().add(instruction);
      // Fetched ONCE, before signing/sending, and reused as-is for
      // confirmation below. Fetching a second, later blockhash afterward
      // (as this used to do) would confirm the already-broadcast
      // transaction against a `lastValidBlockHeight` that has nothing to
      // do with the one it was actually signed with — an unrelated,
      // always-later expiry window, not the real one.
      const { blockhash, lastValidBlockHeight, feePayer } = await attachRecentBlockhash(
        connection,
        publicKey,
      );
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = feePayer;

      /*
       * Preflight before the wallet is asked for anything.
       *
       * The form's enabled/disabled state comes from the backend's
       * `GET /status`, which is a DIFFERENT switch from the on-chain
       * `bridge_config` pause flag — and on 2026-09-09 they disagreed, so
       * the form stayed open while the program rejected every deposit built
       * from it. The user saw the wallet's "this dApp could be malicious"
       * warning rather than a refusal, because a wallet that cannot
       * simulate a transaction cannot show what it would do.
       *
       * An inconclusive simulation is not a refusal — see
       * `./simulate.ts` for why.
       */
      const simulation = await simulateDeposit(connection, transaction);
      if (simulation.kind === "rejected") {
        const { what, next } = describeRejection(simulation);
        throw solanaPreflightError(what, next);
      }

      let signature: string;
      try {
        signature = await adapter.sendTransaction(transaction, connection);
      } catch (cause) {
        throw solanaSendError(cause);
      }

      try {
        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );
      } catch (cause) {
        throw solanaConfirmationError(cause, signature);
      }

      return { signature };
    },
    [ready, adapter, connection],
  );

  return { capability, deposit };
}

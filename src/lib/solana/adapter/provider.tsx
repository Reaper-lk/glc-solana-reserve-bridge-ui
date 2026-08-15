"use client";

import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { env } from "@/lib/config/env";
import { toWalletFailure } from "../errors";
import type { WalletFailure } from "../types";

/**
 * The composition root for wallet support, and the only module that mounts
 * wallet-adapter providers.
 *
 * `wallets` is intentionally empty. `WalletProvider` runs every adapter through
 * `useStandardWalletAdapters`, so any wallet implementing the Wallet Standard —
 * Phantom, Solflare and Backpack among them — registers itself. Bundling
 * per-wallet adapter packages would add weight and, in Backpack's case, a
 * formally deprecated dependency, to reach wallets that are detected anyway.
 *
 * Adding Ledger, WalletConnect or mobile deep links later means extending this
 * one array. No consumer changes.
 */

const NO_EXPLICIT_ADAPTERS: never[] = [];

interface WalletRuntime {
  /** False when no RPC endpoint is configured for this deployment. */
  readonly configured: boolean;
  readonly failure: WalletFailure | null;
  readonly setFailure: (failure: WalletFailure | null) => void;
}

const WalletRuntimeContext = createContext<WalletRuntime>({
  configured: false,
  failure: null,
  setFailure: () => undefined,
});

export function useWalletRuntime(): WalletRuntime {
  return useContext(WalletRuntimeContext);
}

export function SolanaProvider({ children }: { children: ReactNode }) {
  const endpoint = env.solanaRpcUrl;
  const [failure, setFailure] = useState<WalletFailure | null>(null);

  /**
   * Adapter errors arrive here rather than as thrown exceptions. They are
   * translated immediately, so no library error class survives past this point.
   */
  const handleError = useCallback((error: unknown) => {
    setFailure(toWalletFailure(error));
  }, []);

  const runtime = useMemo<WalletRuntime>(
    () => ({ configured: Boolean(endpoint), failure, setFailure }),
    [endpoint, failure],
  );

  // Without an endpoint there is nothing to connect to. `WalletProvider`
  // depends on `ConnectionProvider`, so neither is mounted; the hook layer
  // reports "unconfigured" and every dependent action disables itself with a
  // stated reason rather than failing at the point of use.
  if (!endpoint) {
    return (
      <WalletRuntimeContext.Provider value={runtime}>
        {children}
      </WalletRuntimeContext.Provider>
    );
  }

  return (
    <WalletRuntimeContext.Provider value={runtime}>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider
          wallets={NO_EXPLICIT_ADAPTERS}
          // Reconnects only the wallet the user previously chose, recorded by
          // the adapter under the `walletName` key. It never selects a wallet
          // on the user's behalf and never switches between them.
          autoConnect
          onError={handleError}
        >
          {children}
        </WalletProvider>
      </ConnectionProvider>
    </WalletRuntimeContext.Provider>
  );
}

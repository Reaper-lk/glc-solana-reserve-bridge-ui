/**
 * The public wallet contract.
 *
 * This file defines everything the rest of the application is allowed to know
 * about wallets. It imports NOTHING from `@solana/wallet-adapter-*` or
 * `@solana/web3.js` — and ESLint forbids those imports outside
 * `src/lib/solana`, so the boundary is enforced rather than merely intended.
 *
 * Two consequences that matter:
 *
 *   1. Addresses cross this boundary as strings, never as `PublicKey`. Balances
 *      cross as integer base-unit strings, never as `BN`, `bigint` or a float.
 *   2. Migrating from wallet-adapter to Solana Kit changes the implementation
 *      behind these types and nothing else. No component outside this directory
 *      would need to be touched.
 */

import type { WalletPlatform } from "./platform";

export type { WalletPlatform };

/** Lifecycle of the wallet connection. Mirrors no library's enum. */
export type WalletStatus =
  /** No RPC endpoint configured — wallet features are unavailable. */
  | "unconfigured"
  /** Browser context not yet established (server render or pre-hydration). */
  | "initialising"
  | "disconnected"
  | "connecting"
  | "connected"
  | "disconnecting";

/** A wallet the user could choose, installed or not. */
export interface WalletDescriptor {
  /** Stable identifier used for selection. */
  readonly id: string;
  readonly name: string;
  /** Data URI or URL supplied by the wallet itself; null when absent. */
  readonly iconUrl: string | null;
  /** Whether the wallet is detected in this browser. */
  readonly installed: boolean;
  /** Where to get it, for wallets that are not installed. */
  readonly installUrl: string | null;
}

/**
 * A balance, in the same shape as the bridge API's token amounts so it renders
 * through the existing `TokenAmount` component with no adaptation.
 */
export interface WalletBalance {
  /** Integer string of base units. Never a float. */
  readonly raw: string;
  readonly decimals: number;
  readonly symbol: string;
}

export interface WalletConnectionState {
  readonly status: WalletStatus;
  /** Base58 address of the connected account, or null. */
  readonly address: string | null;
  /** The connected wallet, or null. */
  readonly wallet: WalletDescriptor | null;
  /** Every wallet offered, installed first. */
  readonly wallets: readonly WalletDescriptor[];
  /**
   * Whether this wallet can sign transactions.
   *
   * Exposed as a capability only. No transaction is built or signed in this
   * layer; transaction construction lives inside `src/lib/solana` so that
   * signing types never cross this boundary either.
   */
  readonly canSign: boolean;
  /** Present when the last connection attempt failed. */
  readonly error: WalletFailure | null;
  /**
   * How a wallet can be reached in this browser (design spec A11).
   *
   * Not a device category: it answers whether a wallet can inject here at all,
   * which decides between the wallet list and the deep-link flow. Consumers
   * branch on this rather than sniffing the user agent themselves.
   */
  readonly platform: WalletPlatform;
}

export interface WalletActions {
  /** Choose a wallet and connect to it. Always user-initiated. */
  readonly connect: (walletId: string) => Promise<void>;
  /** Explicit disconnect. Never called automatically. */
  readonly disconnect: () => Promise<void>;
  /** Clears a failed-connection state without reconnecting. */
  readonly dismissError: () => void;
}

export type WalletConnection = WalletConnectionState & WalletActions;

/**
 * A wallet failure, already reduced to the three-part formula the design docs
 * require. Library error classes never escape this directory.
 */
export interface WalletFailure {
  /** Machine-readable, for diagnostics. Never rendered to a user. */
  readonly code: WalletFailureCode;
  readonly what: string;
  readonly funds: string;
  readonly next: string;
  /** Whether an immediate retry is reasonable. */
  readonly retryable: boolean;
}

export type WalletFailureCode =
  | "not-installed"
  | "user-rejected"
  | "connection-failed"
  | "timeout"
  | "unsupported"
  | "unknown";

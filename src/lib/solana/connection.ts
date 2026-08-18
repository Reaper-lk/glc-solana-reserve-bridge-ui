import { Connection } from "@solana/web3.js";
import { env } from "@/lib/config/env";

/**
 * The Solana RPC connection.
 *
 * `NEXT_PUBLIC_SOLANA_RPC_URL` is optional, so a deployment without it is a
 * supported state, not a crash: wallet features report themselves as
 * unconfigured and every dependent action is disabled with a stated reason
 * (acceptance criterion 2).
 */

export function isWalletConfigured(): boolean {
  return Boolean(env.solanaRpcUrl);
}

/** True when the canonical Solana GLC balance can be read at all. */
export function isMintConfigured(): boolean {
  return Boolean(env.reserveMintAddress);
}

let cached: Connection | null = null;

/**
 * A single shared connection. Returns null when unconfigured rather than
 * throwing, so callers handle absence as data.
 */
export function getConnection(): Connection | null {
  if (!env.solanaRpcUrl) return null;
  cached ??= new Connection(env.solanaRpcUrl, "confirmed");
  return cached;
}

/** Exported for tests, which construct their own connection against a mock. */
export function __resetConnectionForTests(): void {
  cached = null;
}

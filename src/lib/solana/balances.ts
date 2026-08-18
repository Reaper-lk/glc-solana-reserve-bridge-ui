import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { WalletBalance } from "./types";

/**
 * Chain balance reads.
 *
 * Deliberately free of `@solana/spl-token`: the token balance comes from
 * `getParsedTokenAccountsByOwner`, which returns the amount and its decimals
 * directly. That package's dependency chain carries a high-severity advisory
 * (`bigint-buffer`), and pulling it in for one derivation the RPC already does
 * would have failed our own CI gate.
 *
 * Balances are returned as integer base-unit strings, never numbers. A SOL
 * balance that round-trips through a float is a balance you cannot trust.
 *
 * The distinction between zero and unknown is preserved everywhere: a wallet
 * with no token account holds zero; an unreadable or unconfigured balance is
 * null, and the UI renders "unavailable" rather than "0".
 */

export const SOL_DECIMALS = 9;

/** Digits in LAMPORTS_PER_SOL, asserted rather than assumed. */
const LAMPORT_DIGITS = Math.round(Math.log10(LAMPORTS_PER_SOL));

export function lamportsToBalance(lamports: number | bigint): WalletBalance {
  const raw =
    typeof lamports === "bigint" ? lamports.toString() : Math.trunc(lamports).toString();
  return { raw, decimals: LAMPORT_DIGITS, symbol: "SOL" };
}

export async function fetchSolBalance(
  connection: Connection,
  address: string,
): Promise<WalletBalance> {
  const lamports = await connection.getBalance(new PublicKey(address));
  return lamportsToBalance(lamports);
}

/**
 * The SPL balance for one mint.
 *
 * Returns a zero balance when the owner has no token account for the mint —
 * that is a real, knowable zero, not an absence. Only an actual failure to read
 * produces a thrown error, which the caller surfaces as "unavailable".
 *
 * An owner can legitimately hold the same mint across MULTIPLE token
 * accounts (the associated token account plus auxiliary accounts older
 * tooling created), so every returned account is summed — reading only the
 * first would silently under-report on exactly the screen where someone
 * decides how much to bridge. All accounts of one mint share the mint's
 * decimals; a disagreement can only mean a malformed response, and fails
 * the read rather than guessing.
 */
export async function fetchTokenBalance(
  connection: Connection,
  owner: string,
  mint: string,
  symbol: string,
): Promise<WalletBalance> {
  const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint: new PublicKey(mint),
  });

  if (accounts.value.length === 0) {
    // No token account yet. The user genuinely holds none.
    return { raw: "0", decimals: 0, symbol };
  }

  let total = 0n;
  let decimals: number | null = null;
  for (const entry of accounts.value) {
    const parsed = parseTokenAmount(entry.account.data, symbol);
    if (decimals === null) {
      decimals = parsed.decimals;
    } else if (decimals !== parsed.decimals) {
      throw new Error("Token accounts for one mint disagreed on decimals");
    }
    total += BigInt(parsed.raw);
  }

  return { raw: total.toString(), decimals: decimals ?? 0, symbol };
}

/**
 * Pull `{ amount, decimals }` out of a parsed token account.
 *
 * The RPC's parsed shape is not typed usefully by web3.js, so it is narrowed
 * defensively here: a malformed response yields a thrown error rather than a
 * plausible-looking wrong number on a screen where someone is deciding how much
 * to bridge.
 */
export function parseTokenAmount(data: unknown, symbol: string): WalletBalance {
  const parsed = (data as { parsed?: { info?: { tokenAmount?: unknown } } } | null)
    ?.parsed;
  const info = parsed?.info?.tokenAmount as
    { amount?: unknown; decimals?: unknown } | undefined;

  const amount = info?.amount;
  const decimals = info?.decimals;

  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new Error("Token account returned a malformed amount");
  }
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    throw new Error("Token account returned malformed decimals");
  }

  return { raw: amount, decimals, symbol };
}

/** Validate a base58 address without leaking PublicKey to callers. */
export function isValidAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

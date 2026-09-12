import type { Connection, Transaction } from "@solana/web3.js";

/**
 * Preflight the deposit by simulating it, before the wallet is ever asked
 * to sign.
 *
 * # Why this exists
 *
 * The Solana -> Goldcoin direction has two independent pause switches: the
 * backend's `GET /status` (`sol_to_glc_available`), which the form already
 * reads, and the on-chain `bridge_config`'s own flag, which it did not. They
 * are not the same switch and they can disagree — on 2026-09-09 the on-chain
 * direction was paused while the API continued to report the route
 * available, so the form stayed enabled and every deposit built from it was
 * rejected by the program with `DepositDirectionPaused` (Anchor 6020).
 *
 * The user-visible symptom was not a clear refusal. It was the wallet's own
 * risk warning: Phantom simulates before it asks for a signature, got a
 * deterministic failure, could not show the user what the transaction would
 * do, and warned that the dApp may be malicious. Asking a wallet to sign a
 * transaction we could have known would fail is what produced that.
 *
 * The EVM side has preflighted for exactly this reason since it shipped
 * (`src/lib/evm/deposit.ts`, `evmPreflightError`). This closes the same gap
 * on the Solana side, and catches every other deterministic rejection for
 * free: an obligation index taken by a racing deposit, an exhausted rolling
 * volume window, a short token balance.
 *
 * # What it deliberately does NOT do
 *
 * A simulation that cannot be obtained — RPC unreachable, transport error,
 * malformed response — is INCONCLUSIVE, and is not treated as a refusal.
 * Refusing there would turn an RPC blip into an outage of the whole
 * direction, and it would not be fail-closed in any meaningful sense: no
 * funds move either way, the wallet still shows the user the transaction,
 * and the user still has to approve it. Only a definitive rejection *by the
 * program* stops the flow.
 */

export type SimulationOutcome =
  | { readonly kind: "ok"; readonly unitsConsumed: number | null }
  /** The program (or the runtime) rejected it. Deterministic — do not sign. */
  | {
      readonly kind: "rejected";
      /** Anchor's own error name, when the logs carry one. */
      readonly errorName: string | null;
      /** Anchor's own error message, when the logs carry one. */
      readonly errorMessage: string | null;
      /** The raw custom error number, when there is one. */
      readonly errorNumber: number | null;
      readonly logs: readonly string[];
    }
  /** No verdict available. Proceed; the wallet remains the user's control. */
  | { readonly kind: "inconclusive"; readonly reason: string };

/**
 * Anchor writes a single, stable line into the program logs on a thrown
 * error:
 *
 *   Error Code: DepositDirectionPaused. Error Number: 6020. Error Message: ...
 *
 * Reading the name and message from there rather than mapping error numbers
 * to strings in this repo is deliberate: an error table here would be a copy
 * of the program's, free to drift from it, and wrong in the one direction
 * that matters — telling a user a confident, stale reason for a refusal.
 * The program's own words are always current.
 */
export function parseAnchorError(logs: readonly string[]): {
  name: string | null;
  message: string | null;
  number: number | null;
} {
  for (const line of logs) {
    const match = line.match(
      /Error Code:\s*(\w+)\.\s*Error Number:\s*(\d+)\.\s*Error Message:\s*(.*?)\.?\s*$/,
    );
    if (match) {
      return { name: match[1]!, message: match[3]! || null, number: Number(match[2]) };
    }
  }
  return { name: null, message: null, number: null };
}

/** The custom error number from a `TransactionError`, when it carries one. */
export function customErrorNumber(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const instructionError = (err as { InstructionError?: unknown }).InstructionError;
  if (!Array.isArray(instructionError) || instructionError.length < 2) return null;
  const detail = instructionError[1];
  if (!detail || typeof detail !== "object") return null;
  const custom = (detail as { Custom?: unknown }).Custom;
  return typeof custom === "number" ? custom : null;
}

export async function simulateDeposit(
  connection: Connection,
  transaction: Transaction,
): Promise<SimulationOutcome> {
  let response;
  try {
    response = await connection.simulateTransaction(transaction);
  } catch (cause) {
    return {
      kind: "inconclusive",
      reason: cause instanceof Error ? cause.message : "simulation request failed",
    };
  }

  const value = response?.value;
  if (!value) return { kind: "inconclusive", reason: "no simulation result" };

  const logs = value.logs ?? [];

  if (value.err) {
    const anchor = parseAnchorError(logs);
    return {
      kind: "rejected",
      errorName: anchor.name,
      errorMessage: anchor.message,
      errorNumber: anchor.number ?? customErrorNumber(value.err),
      logs,
    };
  }

  return { kind: "ok", unitsConsumed: value.unitsConsumed ?? null };
}

/**
 * Turn a rejection into the two sentences the user actually needs.
 *
 * The program's own message is used verbatim when it has one, because it is
 * both accurate and already written for a human. Only the "what to do next"
 * half is ours.
 */
export function describeRejection(
  outcome: Extract<SimulationOutcome, { kind: "rejected" }>,
): {
  what: string;
  next: string;
} {
  const detail =
    outcome.errorMessage ??
    (outcome.errorNumber !== null
      ? `the program rejected it with error ${outcome.errorNumber}`
      : "the program rejected it");

  return {
    what: `This deposit would be rejected by the bridge program, so it was not sent: ${detail}`,
    next: "Nothing was signed. Check the bridge status page — if the route is shown as open and this keeps happening, contact support with this message.",
  };
}

import type { RequestState } from "@/lib/api/schemas/transfer";

/**
 * Classification of the real `RequestState` wire enum
 * (`service/src/ledger/types.rs` in glc-solana-reserve-bridge). Do not add
 * or invent states here — every value must be one the backend actually
 * emits.
 */

const TERMINAL_STATES = new Set<RequestState>([
  "Settled",
  "Expired",
  "Cancelled",
  "Reorged",
  "InsufficientReserveAtSettlement",
  "DestinationSubmissionFailed",
  "Failed",
]);

/** States the backend has not yet implemented a code path to reach (see docs/MIGRATION_ASSESSMENT.md). */
const UNEXERCISED_STATES = new Set<RequestState>([
  "SettlementAuthorized",
  "DestinationSubmitted",
  "DestinationConfirmed",
  "Settled",
]);

export function isTerminalState(state: RequestState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isSuccessState(state: RequestState): boolean {
  return state === "Settled";
}

export function isFailureState(state: RequestState): boolean {
  return (
    state === "Expired" ||
    state === "Cancelled" ||
    state === "Reorged" ||
    state === "InsufficientReserveAtSettlement" ||
    state === "DestinationSubmissionFailed" ||
    state === "Failed"
  );
}

export function isManualReview(state: RequestState): boolean {
  return state === "ManualReview";
}

export function isUnexercisedState(state: RequestState): boolean {
  return UNEXERCISED_STATES.has(state);
}

/**
 * The ordered "happy path" sequence for a direction, used to render a
 * stepper. `SolToGlc` skips `Confirming` — it folds directly to
 * `SourceFinalized` with no confirmation ramp
 * (`TransferView.required_source_confirmations` is always null for it).
 */
export function happyPathFor(direction: "GlcToSol" | "SolToGlc"): RequestState[] {
  const base: RequestState[] = [
    "AwaitingDeposit",
    "DepositObserved",
    ...(direction === "GlcToSol" ? (["Confirming"] as RequestState[]) : []),
    "SourceFinalized",
    "SettlementAuthorized",
    "DestinationSubmitted",
    "Settled",
  ];
  return base;
}

export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  LiquidityReserved: "Reserving capacity",
  AwaitingDeposit: "Awaiting your deposit",
  DepositObserved: "Deposit observed",
  Confirming: "Confirming",
  SourceFinalized: "Source confirmed",
  SettlementAuthorized: "Settlement authorized",
  DestinationSubmitted: "Sending your funds",
  DestinationConfirmed: "Destination confirmed",
  Settled: "Settled",
  Expired: "Expired",
  Cancelled: "Cancelled",
  Reorged: "Reversed by a chain reorganization",
  InsufficientReserveAtSettlement: "Reserve capacity ran out before settlement",
  DestinationSubmissionFailed: "Destination transaction failed",
  ManualReview: "Under manual review",
  Failed: "Failed",
};

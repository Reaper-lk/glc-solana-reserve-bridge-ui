import { requestStateSchema, type RequestState } from "@/lib/api/schemas/transfer";
import type { Route } from "@/lib/api/schemas/common";

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
  "Refunded",
  "Failed",
]);

/**
 * The refund lifecycle: a request the pipeline could not settle has its
 * deposit returned. `Refunded` is terminal and is NOT a failure — the money
 * came back — but it is not a settlement success either, so it is its own
 * classification rather than being folded into one of those two.
 */
export type RefundState = Extract<
  RequestState,
  "RefundPending" | "RefundBroadcast" | "Refunded"
>;

const REFUND_STATES = new Set<RequestState>([
  "RefundPending",
  "RefundBroadcast",
  "Refunded",
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

export function isRefundState(state: RequestState): state is RefundState {
  return REFUND_STATES.has(state);
}

/**
 * The ordered "happy path" sequence for a route, used to render a stepper.
 *
 * The `Confirming` step belongs to GOLDCOIN-SOURCED routes only. A
 * Goldcoin deposit is confirmation-tracked block by block, so there is a
 * real ramp to show; a contract-sourced deposit (`SolToGlc`, `RhnToGlc`)
 * folds straight to `SourceFinalized` once its obligation is observed and
 * has no confirmation count to progress through — which is exactly why
 * `TransferView.required_source_confirmations` is null for those.
 *
 * Keyed on the source chain rather than on a list of route names so a
 * route added later gets the right shape without this function being
 * revisited.
 */
export function happyPathFor(route: Route): RequestState[] {
  const sourceIsGoldcoin = route === "GlcToSol" || route === "GlcToRhn";
  const base: RequestState[] = [
    "AwaitingDeposit",
    "DepositObserved",
    ...(sourceIsGoldcoin ? (["Confirming"] as RequestState[]) : []),
    "SourceFinalized",
    "SettlementAuthorized",
    "DestinationSubmitted",
    "DestinationConfirmed",
    "Settled",
  ];
  return base;
}

/**
 * Per-step status for the detail page's stepper.
 *
 * Lives here, not in the component, because the mapping from one backend
 * state to a whole column of done/active/pending marks is the part that can
 * be wrong, and being wrong is invisible in a screenshot — `#4099` sat in
 * `DestinationConfirmed` with every circle drawn empty and nobody could tell
 * from the markup whether that was the backend or the renderer.
 *
 * It was the renderer. `DestinationConfirmed` was missing from
 * `happyPathFor`, so the component's `indexOf` returned -1 and its
 * `currentIndex === -1` branch marked EVERY step pending — a transfer whose
 * funds had already reached the destination rendered as one where nothing
 * had happened at all.
 *
 * The rules, stated rather than derived:
 *
 * - A state ON the path marks everything before it done and itself active.
 * - `Settled` is the terminal success, so every step including it is done —
 *   an active final step reads as "still working" on a finished transfer.
 * - A state OFF the path is not guessed at. `LiquidityReserved` precedes
 *   the deposit, so nothing is done yet; anything else off-path (failure,
 *   manual review, refund) is not rendered as a stepper by the caller at
 *   all, and gets the same honest all-pending answer rather than an
 *   invented position.
 */
export type StepStatus = "done" | "active" | "pending";

export function stepperStatusesFor(route: Route, state: RequestState): StepStatus[] {
  const sequence = happyPathFor(route);

  if (state === "Settled") return sequence.map(() => "done");

  const currentIndex = sequence.indexOf(state);
  if (currentIndex === -1) return sequence.map(() => "pending");

  return sequence.map((_step, index) =>
    index < currentIndex ? "done" : index === currentIndex ? "active" : "pending",
  );
}

/**
 * Whether the transfer is moving through the pipeline under its own steam —
 * no operator action, no failure, not yet finished.
 *
 * Used for the one neutral line under the stepper. It replaces a warning
 * that said these states were "still being rolled out on this deployment":
 * true when the settlement pipeline was partly manual, false and alarming
 * once automation went live, and shown on `Settled` — a transfer that had
 * completely finished.
 */
export function isInFlightState(state: RequestState): boolean {
  return (
    !isTerminalState(state) &&
    !isFailureState(state) &&
    !isManualReview(state) &&
    !isRefundState(state)
  );
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
  RefundPending: "Refund pending",
  RefundBroadcast: "Refund broadcast",
  Refunded: "Refunded",
  Failed: "Failed",
};

const KNOWN_REQUEST_STATES: ReadonlySet<string> = new Set<string>(
  requestStateSchema.options,
);

/**
 * Narrows a state name off the wire to one this build actually models.
 *
 * `GET /explorer/events` accepts any structurally-valid state name so that a
 * lifecycle state added after this build shipped cannot fail the whole feed
 * (`eventRequestStateSchema` in `src/lib/api/schemas/explorer`). Anything
 * that indexes a `Record<RequestState, …>` with such a value must narrow it
 * here first.
 */
export function isKnownRequestState(state: string): state is RequestState {
  return KNOWN_REQUEST_STATES.has(state);
}

/**
 * Plain-English name for a state TRANSITION, where the pair says something
 * the two badges either side of the arrow do not.
 *
 * Only the refund lifecycle earns an entry today: "ManualReview →
 * RefundPending" reads as a status change, whereas "Refund started" reads as
 * the event that actually happened. Every other pair returns null and is
 * rendered as the two states alone — an invented sentence for a transition
 * whose meaning is not certain would be worse than none.
 */
const TRANSITION_LABELS: ReadonlyMap<string, string> = new Map([
  ["ManualReview->RefundPending", "Refund started"],
  ["RefundPending->RefundBroadcast", "Refund broadcast"],
  ["RefundBroadcast->Refunded", "Refund confirmed"],
]);

export function transitionLabel(from: string | null, to: string): string | null {
  if (from === null) return null;
  return TRANSITION_LABELS.get(`${from}->${to}`) ?? null;
}

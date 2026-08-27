/**
 * Bridge form domain logic.
 *
 * Pure functions over strings and integers, with no React and no network.
 * There is deliberately no client-side fee/quote calculator here — the
 * bridge backend (`POST /quote`) is the sole source of truth for gross,
 * fee, and net amounts; see `src/lib/query/hooks.ts`'s `useQuote`.
 */

export { directions, oppositeDirection, GOLDCOIN_GLC, SOLANA_GLC } from "./direction";
export type {
  ChainDescriptor,
  DirectionDescriptor,
  DirectionSide,
  TokenDescriptor,
} from "./direction";

export { validateAmount, isReportableProblem, display } from "./amount";
export type { AmountBounds, AmountProblem, AmountValidation } from "./amount";

export {
  validateGoldcoinAddress,
  isReportableAddressProblem,
  encodeBase58Check,
} from "./glc-address";
export type { AddressProblem, AddressRules, AddressValidation } from "./glc-address";

export { goldcoinAddressRules } from "./address-rules";

export {
  isTerminalState,
  isSuccessState,
  isFailureState,
  isManualReview,
  isUnexercisedState,
  happyPathFor,
  REQUEST_STATE_LABELS,
} from "./state";

export {
  directionGateState,
  destinationPaused,
  quotaExhausted,
  rollingVolumeRemaining,
  directionAvailable,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_PAUSED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
} from "./direction-state";
export type { DirectionGateState } from "./direction-state";

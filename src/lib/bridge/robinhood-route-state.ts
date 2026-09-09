import type {
  RobinhoodReserveDto,
  RobinhoodWindowDto,
} from "@/lib/api/schemas/robinhood";
import { isRobinhoodAvailable } from "@/lib/api/schemas/robinhood";
import { toBigInt } from "@/lib/api/schemas/common";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { ROBINHOOD_DECIMALS } from "./robinhood-amount";

/**
 * Per-route operational state for the two Robinhood routes, derived from
 * `GET /robinhood/reserve`.
 *
 * # Why this is a separate module from `./direction-state`
 *
 * `./direction-state` reads `GET /status`, every field of which is named
 * for `GlcToSol`/`SolToGlc` and whose rolling-volume figures come from a
 * Solana PDA bounding the Solana reserve. It is typed to
 * `SolanaGovernedRoute` precisely so a Robinhood route cannot reach it and
 * be answered with Solana's numbers.
 *
 * The Robinhood routes have their own, genuinely different sources: a
 * third reserve ledger in canonical units, a custody contract with two
 * independent kill switches and two independent rolling windows in its own
 * 18-decimal unit, and an indexer whose liveness is reported separately.
 * Same shape of answer, entirely different derivation — so, a separate
 * module rather than a widened one.
 *
 * # Every state below is read, never inferred
 *
 * There is no branch here that produces a figure the backend did not send.
 * A reserve with no ledger row is `unknown`, not zero. A contract that
 * could not be read yields `degraded`, not "fine" and not "paused" — the
 * windows and kill switches are genuinely unknown in that state, and
 * claiming either would be a guess about money.
 */

/** The two routes that touch the Robinhood custody contract. */
export type RobinhoodRoute = "GlcToRhn" | "RhnToGlc";

export type RobinhoodRouteGateState =
  /** Open, funded, within its window, and reporting live figures. */
  | "active"
  /** The Robinhood reserve's own operator pause. */
  | "operator-paused"
  /** The custody contract's own kill switch for THIS leg. */
  | "contract-paused"
  /** Destination reserve capacity is at or below zero. */
  | "capacity-constrained"
  /** This leg's rolling 24h window has no headroom left. */
  | "quota-exhausted"
  /** Open, but a live figure is missing: unread contract, or a stalled indexer. */
  | "degraded"
  /** No reserve row, or `/robinhood/reserve` has not answered. Fail closed. */
  | "unknown";

/**
 * The contract window that bounds this route's Robinhood-side leg.
 *
 * `GlcToRhn` PAYS OUT onto Robinhood, so it is charged against the
 * outbound window; `RhnToGlc` takes a DEPOSIT on Robinhood and is charged
 * against the inbound one. Crossing them would report a limit the contract
 * does not apply to this route.
 */
export function robinhoodWindowFor(
  route: RobinhoodRoute,
  reserve: RobinhoodReserveDto | undefined,
): RobinhoodWindowDto | null {
  if (!reserve || !isRobinhoodAvailable(reserve.onchain.availability)) return null;
  return route === "GlcToRhn"
    ? reserve.onchain.outbound_window
    : reserve.onchain.inbound_window;
}

/** An amount together with the decimals it is actually denominated in. */
export interface RobinhoodFigure {
  readonly atomic: string;
  readonly decimals: number;
}

/**
 * The remaining rolling-24h headroom for this route, in ROBINHOOD's native
 * 18 decimals — the unit the contract accounts in. `null` when the
 * contract could not be read, which a caller must render as unknown rather
 * than as zero: "no headroom left" and "we could not ask" are opposite
 * facts about whether a transfer will go through.
 */
export function robinhoodWindowRemaining(
  route: RobinhoodRoute,
  reserve: RobinhoodReserveDto | undefined,
): RobinhoodFigure | null {
  const window = robinhoodWindowFor(route, reserve);
  if (!window) return null;
  return { atomic: window.remaining_atomic, decimals: ROBINHOOD_DECIMALS };
}

/**
 * The available capacity of the reserve this route PAYS OUT OF.
 *
 * `GlcToRhn` settles onto the Robinhood reserve, whose ledger the backend
 * keeps in CANONICAL 8-decimal units — deliberately not Robinhood's 18,
 * because the ledger column is an `INTEGER` and cannot hold the latter.
 * `RhnToGlc` settles onto the Goldcoin reserve, which is published by
 * `GET /reserve` and passed in here: this module never substitutes one
 * reserve's figure for another's, matching a backend that keeps the three
 * pools strictly separate because one cannot cover another.
 */
export function robinhoodDestinationCapacity(
  route: RobinhoodRoute,
  reserve: RobinhoodReserveDto | undefined,
  goldcoinCapacityAtomic: string | null,
): RobinhoodFigure | null {
  if (route === "RhnToGlc") {
    return goldcoinCapacityAtomic === null
      ? null
      : { atomic: goldcoinCapacityAtomic, decimals: GOLDCOIN_DECIMALS };
  }
  if (!reserve || !isRobinhoodAvailable(reserve.ledger_availability)) return null;
  const capacity = reserve.available_capacity_atomic;
  return capacity === null ? null : { atomic: capacity, decimals: GOLDCOIN_DECIMALS };
}

/** The contract kill switch that applies to this route's Robinhood leg. */
function legPaused(route: RobinhoodRoute, reserve: RobinhoodReserveDto): boolean | null {
  return route === "GlcToRhn"
    ? reserve.onchain.payouts_paused
    : reserve.onchain.deposits_paused;
}

/**
 * The route's operational state.
 *
 * Order of the checks is deliberate, from most certainly-blocking to
 * least. A pause is a fact the backend states outright; a zero capacity or
 * a spent window is a fact arithmetic on a real figure establishes; only
 * then does an unread contract or a stalled indexer downgrade the route to
 * `degraded`. Reversing any of those would report a soft problem while a
 * hard stop was in force.
 *
 * `destinationCapacityAtomic` is the SAME figure
 * {@link robinhoodDestinationCapacity} resolves, passed in so the badge and
 * the number beside it can never come from different reads.
 */
export function robinhoodRouteGateState(
  route: RobinhoodRoute,
  reserve: RobinhoodReserveDto | undefined,
  destinationCapacityAtomic: string | null,
): RobinhoodRouteGateState {
  if (!reserve) return "unknown";
  // No `reserve_ledger` row: this deployment has no Robinhood reserve at
  // all. Nothing below it is knowable, and "not paused" would be a claim
  // about a reserve that does not exist.
  if (!isRobinhoodAvailable(reserve.ledger_availability)) return "unknown";

  if (reserve.paused === true) return "operator-paused";
  if (legPaused(route, reserve) === true) return "contract-paused";

  if (destinationCapacityAtomic !== null && toBigInt(destinationCapacityAtomic) <= 0n) {
    return "capacity-constrained";
  }

  const window = robinhoodWindowFor(route, reserve);
  if (window && toBigInt(window.remaining_atomic) <= 0n) return "quota-exhausted";

  const contractRead = isRobinhoodAvailable(reserve.onchain.availability);
  const indexerStalled =
    reserve.indexer.halted || (reserve.indexer.configured && !reserve.indexer.connected);
  if (!contractRead || indexerStalled) return "degraded";

  return "active";
}

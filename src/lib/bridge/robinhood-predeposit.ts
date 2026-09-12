import type { EligibilityRoute } from "./eligibility";

/**
 * The pre-deposit AVAILABILITY gate for the two contract-sourced
 * Robinhood routes — `RhnToGlc` and `RhnToSol`.
 *
 * # Why these routes need a gate the others do not
 *
 * Every Goldcoin-sourced route asks the backend for permission before
 * anything leaves a wallet: `POST /transfers` can refuse outright.
 * `SolToGlc` submits `deposit_to_reserve` itself, but its funds land in a
 * Solana program the bridge controls.
 *
 * These two do neither. The user calls the custody contract's `deposit`
 * directly and their GLC is gone the moment it confirms — there is no
 * preflight the backend can refuse, and a deposit that arrives while the
 * destination reserve is closed is not rejected, it is folded and parked
 * in `ManualReview` with the funds already committed.
 *
 * # This module owns availability, not eligibility
 *
 * The rolling-24h WALLET windows used to live here too, for `RhnToGlc`
 * alone, because that was the only route the backend published an
 * endpoint for. They now live in `./eligibility`, which gates all six
 * routes through one normalised verdict — so there is exactly one place
 * that decides what "this wallet may bridge" means, and it is the same
 * place on every route. What is left here is the question `./eligibility`
 * does not answer and `GET /chains` does: is the route itself open.
 *
 * # This is protection, not enforcement
 *
 * The backend re-checks route availability authoritatively at fold time.
 * Nothing here can weaken that and nothing here is trusted by it. What
 * this adds is the one thing the authoritative check cannot: refusing
 * BEFORE the transaction is signed, while the funds are still the user's.
 * So every branch fails closed — an unreadable `/chains` disables the
 * deposit and says so, because the cost of a wrong "yes" is unrecoverable
 * and the cost of a wrong "no" is a retry.
 */

/**
 * Shown when `/chains` says the route is enabled but not currently
 * available, and the backend published no sentence of its own for it.
 * The backend's `unavailable_reason` is preferred wherever it exists —
 * this UI never authors a second explanation of a backend decision.
 */
export const ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK =
  "This route is temporarily unavailable and cannot accept a deposit right now.";

/**
 * The plausible range for a `retry_after`, as unix SECONDS: 2001-09-09 to
 * 2100-01-01.
 *
 * A bound rather than a bare `Number.isFinite` because the realistic way
 * this field goes wrong is a unit mistake — milliseconds where seconds
 * were meant, which is finite, positive, and renders as a date in the
 * year 55000. Refusing that and falling through to `retry_after_seconds`
 * is strictly better than showing a user a wait of thirty millennia.
 */
const EARLIEST_PLAUSIBLE_RETRY_AT = 1_000_000_000;
const LATEST_PLAUSIBLE_RETRY_AT = 4_102_444_800;

/**
 * Whether `retry_after` is a timestamp this UI is willing to render.
 *
 * Exported so `./eligibility` applies the SAME plausibility bound when it
 * normalises the per-side instants. Two copies of this test would be two
 * places for "milliseconds where seconds were meant" to be caught
 * differently.
 */
export function isUsableRetryTimestamp(
  value: number | null | undefined,
): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value >= EARLIEST_PLAUSIBLE_RETRY_AT &&
    value <= LATEST_PLAUSIBLE_RETRY_AT
  );
}

/**
 * "in about 11 hours" / "in about 40 minutes" / "in under a minute", from
 * the backend's own `retry_after_seconds`.
 *
 * Approximate ON PURPOSE, and always rounded UP. This is the fallback
 * spelling, used only when no usable absolute timestamp came back: a
 * relative figure starts going stale the moment it renders, so a
 * precise-looking "10 hours 42 minutes" would invite a user to come back
 * at exactly that moment and be refused again. Rounding up means the
 * stated wait is never shorter than the real one.
 */
export function formatRetryAfter(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return "in under a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * When the window reopens, as the user's own local date and time.
 *
 * `toLocaleString()` on a unix-seconds field, which is how every other
 * backend instant in this app is rendered (`TransferRow`, `EventRow`,
 * `ReservesView`, `TransferDetail`) — a rolling-24h window that reopens
 * "after 6:12 PM" is something a person can plan around in a way that "in
 * about 11 hours" is not, and unlike the relative figure it does not
 * silently decay while the page sits open.
 */
export function formatRetryAt(timestamp: number | null | undefined): string | null {
  if (!isUsableRetryTimestamp(timestamp)) return null;
  const when = new Date(timestamp * 1000);
  if (Number.isNaN(when.getTime())) return null;
  return `after ${when.toLocaleString()}`;
}

/** Why a Robinhood deposit may not be submitted, or that it may. */
export type RobinhoodPredepositVerdict =
  | { readonly kind: "allowed" }
  /** `/chains` reported the route enabled but not currently available. */
  | { readonly kind: "route-unavailable"; readonly reason: string };

export interface RobinhoodPredepositInput {
  /** The contract-sourced route this verdict is about. */
  readonly route: Extract<EligibilityRoute, "RhnToGlc" | "RhnToSol">;
  /**
   * `isRouteEffectivelyAvailable(chains, route)` — `/chains` positively
   * answered `available: true`. An absent field is `false` here, never a
   * shrug.
   */
  readonly routeAvailable: boolean;
  /** The backend's `unavailable_reason`, when it published one. */
  readonly unavailableReason: string | null;
}

/**
 * The availability half of the pre-deposit gate, as one pure function —
 * used by the form to disable the button AND by the submit path to refuse
 * a click, so the two can never disagree about what "allowed" means.
 *
 * "Allowed" here means only that the ROUTE is open. The wallet-eligibility
 * half is `routeEligibilityVerdict`, which the form applies to every route
 * including these two; both must pass.
 */
export function robinhoodPredepositVerdict(
  input: RobinhoodPredepositInput,
): RobinhoodPredepositVerdict {
  if (!input.routeAvailable) {
    return {
      kind: "route-unavailable",
      reason: input.unavailableReason ?? ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
    };
  }
  return { kind: "allowed" };
}

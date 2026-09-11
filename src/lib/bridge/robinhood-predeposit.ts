import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";

/**
 * The pre-deposit gate for `RhnToGlc`, in copy and in one decision
 * function.
 *
 * # Why this route needs a gate the others do not
 *
 * Every other route this bridge runs asks the backend for permission
 * before anything leaves a wallet. `GlcToSol`/`GlcToRhn` go through
 * `POST /transfers`, which refuses outright. `SolToGlc` submits
 * `deposit_to_reserve` itself, but its funds land in a Solana program the
 * bridge controls.
 *
 * `RhnToGlc` does neither. The user calls the custody contract's `deposit`
 * directly and their GLC is gone the moment it confirms — there is no
 * preflight the backend can refuse, and a deposit that arrives while the
 * Goldcoin reserve is closed is not rejected, it is folded and parked in
 * `ManualReview` (`admission_closed_at_fold`) with the funds already
 * committed. That is the production launch-blocker backend PR #76 and PR
 * #74 exist to close, and this module is its frontend half.
 *
 * # This is protection, not enforcement
 *
 * The backend re-checks route availability and both rolling-24h windows
 * authoritatively at fold time, keyed by the contract's own recorded
 * depositor — never by anything a client sent. Nothing here can weaken
 * that, and nothing here is trusted by it. What this adds is the one
 * thing the authoritative check cannot: refusing BEFORE the transaction
 * is signed, while the funds are still the user's.
 *
 * So every branch fails closed. An unreadable `/chains`, an unreadable
 * eligibility endpoint, a verdict about a different address than the one
 * in the form — each disables the deposit and says so, because the cost
 * of a wrong "yes" here is unrecoverable and the cost of a wrong "no" is
 * a retry.
 */

/**
 * The rolling window blocked on the CONNECTED ROBINHOOD WALLET: one
 * qualifying deposit per EVM address per rolling 24 hours.
 *
 * Separate copy from `@/lib/bridge/source-wallet-rate-limit`'s Solana
 * sentence rather than a shared one with the network name substituted:
 * these are two different limits on two different chains, counted in two
 * separate windows that never charge to one another, and a user who has
 * both wallets connected has to be able to tell which of them the message
 * is about.
 */
export const ROBINHOOD_SOURCE_WALLET_RATE_LIMIT_TITLE =
  "This Robinhood Network wallet has already used the bridge in the last 24 hours.";

/**
 * The rolling window blocked on the GOLDCOIN DESTINATION. Deliberately
 * the same sentence `@/lib/bridge/recipient-rate-limit` shows for
 * `SolToGlc`, imported rather than restated below, because it is
 * literally the same limit: one window per Goldcoin address across every
 * inbound route (backend PR #74), so a recent Solana-funded payout blocks
 * a Robinhood-funded one to the same address.
 */
export { RECIPIENT_RATE_LIMIT_TITLE as ROBINHOOD_RECIPIENT_RATE_LIMIT_TITLE } from "./recipient-rate-limit";

/**
 * Shown when the eligibility endpoint could not be read at all — a
 * network failure, a timeout, a deployment that does not serve it, or a
 * verdict that came back about different inputs than the form now holds.
 *
 * It says the check did not complete, NOT that the user is rate-limited:
 * claiming a limit the backend never asserted would be its own kind of
 * wrong answer, and the two have different remedies.
 */
export const ROBINHOOD_ELIGIBILITY_UNKNOWN_TITLE =
  "We could not confirm this deposit would be accepted.";

export const ROBINHOOD_ELIGIBILITY_UNKNOWN_NEXT =
  "A Robinhood Network deposit cannot be reversed once it is sent, so depositing stays disabled until this check succeeds. Try again in a moment.";

/**
 * Shown when `/chains` says the route is enabled but not currently
 * available, and the backend published no sentence of its own for it.
 * The backend's `unavailable_reason` is preferred wherever it exists —
 * this UI never authors a second explanation of a backend decision.
 */
export const ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK =
  "This route is temporarily unavailable and cannot accept a deposit right now.";

/** Which of the two rolling windows a message is about. */
export type RateLimitedBy = "source_wallet_rate_limited" | "recipient_rate_limited";

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

/** Whether `retry_after` is a timestamp this UI is willing to render. */
function isUsableTimestamp(value: number | null | undefined): value is number {
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
  if (!isUsableTimestamp(timestamp)) return null;
  const when = new Date(timestamp * 1000);
  if (Number.isNaN(when.getTime())) return null;
  return `after ${when.toLocaleString()}`;
}

/**
 * The backend's reopen time for ONE of the two limits, in both spellings
 * it publishes.
 *
 * Per-limit first (`source_wallet_retry_after`/`recipient_retry_after`,
 * added by backend PR #74 so a caller naming ONE limit can show THAT
 * limit's wait), falling back to the aggregate pair, which describes
 * whichever limit `blocked_reason` named and is therefore only usable
 * when that is this limit.
 */
export function retryTimeFor(
  verdict: RecipientEligibilityDto,
  limit: RateLimitedBy,
): { readonly at: number | null; readonly seconds: number | null } {
  const perLimit =
    limit === "source_wallet_rate_limited"
      ? verdict.source_wallet_retry_after
      : verdict.recipient_retry_after;
  const aggregateIsThisLimit = verdict.blocked_reason === limit;
  const at = perLimit ?? (aggregateIsThisLimit ? verdict.retry_after : null) ?? null;
  const seconds =
    perLimit !== null && perLimit !== undefined && verdict.retry_after !== null
      ? // Re-based against the aggregate pair the backend computed at the
        // same instant, so no clock on this machine enters the arithmetic.
        (verdict.retry_after_seconds ?? 0) + (perLimit - verdict.retry_after)
      : aggregateIsThisLimit
        ? (verdict.retry_after_seconds ?? null)
        : null;
  return { at, seconds };
}

/**
 * The one retry sentence to show under a blocked message — and nothing at
 * all when the backend supplied no time.
 *
 * # Absolute first, relative second, invented never
 *
 * `retry_after` is preferred whenever it is a timestamp worth rendering:
 * it is an instant, so it stays correct however long the page sits open,
 * while `retry_after_seconds` was measured against a clock that has since
 * moved on. `retry_after_seconds` is the fallback for a response that
 * carried only that, or whose timestamp failed the plausibility check.
 * When neither is usable the sentence is empty: a rolling window nobody
 * published a reopen time for is not one this UI may guess at, and "try
 * again in 24 hours" would be a number the backend never said.
 *
 * # Why the subject is named
 *
 * The two limits are independent and can reopen at different times, so
 * the sentence says WHICH of them it is timing. The blocker's title
 * already distinguishes them; repeating it here means the retry line is
 * still unambiguous read on its own, next to a title it may be visually
 * separated from.
 */
export function retryAfterSentence(
  verdict: RecipientEligibilityDto,
  limit: RateLimitedBy,
): string {
  const { at, seconds } = retryTimeFor(verdict, limit);
  const phrase = formatRetryAt(at) ?? formatRetryAfter(seconds);
  if (phrase === null) return "";
  const subject =
    limit === "source_wallet_rate_limited"
      ? "This Robinhood Network wallet can bridge again"
      : "This Goldcoin address can receive again";
  return `${subject} ${phrase}.`;
}

/**
 * Whether a verdict the UI is holding actually answers the question the
 * form is asking RIGHT NOW.
 *
 * The backend echoes `address` and `wallet` back for exactly this: a
 * cached or in-flight answer about the previous destination — or about a
 * wallet the user has since switched away from — is not a weaker answer,
 * it is an answer to a different question, and treating it as a "yes"
 * would let a stale success authorize a deposit whose inputs it never
 * saw. React Query keys both values so this should not arise; it is
 * checked anyway because the failure it prevents is unrecoverable.
 *
 * `wallet` is compared case-insensitively: the backend returns
 * `0x`-prefixed lowercase hex, while a browser wallet reports the EIP-55
 * mixed-case spelling of the same 20 bytes.
 */
export function verdictMatchesInputs(
  verdict: RecipientEligibilityDto,
  address: string,
  wallet: string | null,
): boolean {
  if (verdict.address !== address) return false;
  if (wallet === null) return verdict.wallet === null;
  if (verdict.wallet === null) return false;
  return verdict.wallet.toLowerCase() === wallet.toLowerCase();
}

/** Why a Robinhood deposit may not be submitted, or that it may. */
export type RobinhoodPredepositVerdict =
  | { readonly kind: "allowed" }
  /** `/chains` reported the route enabled but not currently available. */
  | { readonly kind: "route-unavailable"; readonly reason: string }
  /** The eligibility answer is missing, unreadable, or about other inputs. */
  | { readonly kind: "eligibility-unknown" }
  | {
      readonly kind: "source-wallet-rate-limited";
      /** "" when the backend published no reopen time. */
      readonly retryAfter: string;
    }
  | {
      readonly kind: "recipient-rate-limited";
      readonly retryAfter: string;
    };

export interface RobinhoodPredepositInput {
  /**
   * `isRouteEffectivelyAvailable(chains, route)` — `/chains` positively
   * answered `available: true`. An absent field is `false` here, never a
   * shrug.
   */
  readonly routeAvailable: boolean;
  /** The backend's `unavailable_reason`, when it published one. */
  readonly unavailableReason: string | null;
  /**
   * Whether a rolling-window eligibility answer is part of this route's
   * gate at all.
   *
   * `true` for `RhnToGlc`, whose payout lands on Goldcoin and is therefore
   * subject to the per-recipient and per-source-wallet 24-hour windows
   * `GET /recipients/rhn-to-glc/eligibility` reports.
   *
   * `false` for `RhnToSol`. Those windows are GOLDCOIN-PAYOUT policy —
   * the backend publishes exactly two eligibility endpoints, both
   * `*-to-glc`, and Phase H's own notes say the cooldowns "do not apply to
   * either cross route". There is no endpoint to ask, so requiring an
   * answer would be a gate nothing could ever satisfy; and inventing one
   * locally would be this client enforcing a limit the bridge does not
   * have.
   *
   * The AVAILABILITY half is unconditional. It is the part that stands in
   * front of an irreversible deposit, and it applies to every route whose
   * funds reach the custody contract with no `POST /transfers` preflight —
   * which is both of them.
   */
  readonly eligibilityApplies: boolean;
  /** The eligibility verdict, or `null` for pending/failed/absent. */
  readonly eligibility: RecipientEligibilityDto | null;
  /** The trimmed destination address the form currently holds. */
  readonly address: string;
  /** The connected EVM wallet the form currently holds. */
  readonly wallet: string | null;
}

/**
 * The whole gate, as one pure function — used by the form to disable the
 * button AND by the submit path to refuse a click, so the two can never
 * disagree about what "allowed" means.
 */
export function robinhoodPredepositVerdict(
  input: RobinhoodPredepositInput,
): RobinhoodPredepositVerdict {
  // Availability first. A closed route is not a fact about this user's
  // address or wallet, and asking them to wait out a rolling window they
  // are not in would be the wrong remedy.
  if (!input.routeAvailable) {
    return {
      kind: "route-unavailable",
      reason: input.unavailableReason ?? ROBINHOOD_ROUTE_UNAVAILABLE_FALLBACK,
    };
  }
  // A route with no rolling-window policy is allowed once availability has
  // positively said yes. This is not a relaxation: there is no second
  // question for this route, so there is no second answer to withhold, and
  // the strict availability check above is unchanged.
  if (!input.eligibilityApplies) return { kind: "allowed" };
  const verdict = input.eligibility;
  if (!verdict) return { kind: "eligibility-unknown" };
  if (!verdictMatchesInputs(verdict, input.address, input.wallet)) {
    return { kind: "eligibility-unknown" };
  }
  if (verdict.eligible) return { kind: "allowed" };
  // Wallet-first when both limits block, matching the backend's own fold
  // precedence. `blocked_reasons` carries the full set; the single
  // `blocked_reason` is what decides the one sentence shown, and both are
  // consulted so an older backend that omits the array still resolves.
  const blocking = new Set<string>([
    ...(verdict.blocked_reasons ?? []),
    ...(verdict.blocked_reason ? [verdict.blocked_reason] : []),
  ]);
  if (blocking.has("source_wallet_rate_limited")) {
    return {
      kind: "source-wallet-rate-limited",
      retryAfter: retryAfterSentence(verdict, "source_wallet_rate_limited"),
    };
  }
  if (blocking.has("recipient_rate_limited")) {
    return {
      kind: "recipient-rate-limited",
      retryAfter: retryAfterSentence(verdict, "recipient_rate_limited"),
    };
  }
  // `eligible: false` with no reason the backend named. Nothing here may
  // invent one, and nothing here may let it through.
  return { kind: "eligibility-unknown" };
}

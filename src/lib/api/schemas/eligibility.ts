import { z } from "zod";
import { directionSchema } from "./common";

/**
 * `RecipientEligibility` — the ONE response shape shared by
 * `GET /recipients/sol-to-glc/eligibility` and
 * `GET /recipients/rhn-to-glc/eligibility` (service/src/api.rs in
 * glc-solana-reserve-bridge, built by the same
 * `RecipientEligibility::from_windows`): whether the entered Goldcoin
 * destination address, and (when a wallet is connected) the connected
 * source wallet, are currently eligible for a new bridge payout on that
 * inbound route — or one of them is still inside the backend's rolling
 * 24-hour window.
 *
 * Two INDEPENDENT limits, both enforced. The RECIPIENT limit is
 * route-agnostic: a Goldcoin address may receive at most one accepted
 * payout per rolling 24 hours from ANY inbound route, so a recent
 * `SolToGlc` payout blocks `RhnToGlc` to the same address and vice versa
 * (backend PR #74). The SOURCE-WALLET limit is per source network — a
 * base58 Solana pubkey and a 20-byte EVM address are different identities
 * on different chains and are never charged to one another — and it
 * closes the bypass where one wallet spreads deposits across many
 * different recipients.
 *
 * Read-only, and ADVISORY for `SolToGlc`: the backend re-checks both rules
 * authoritatively at admission time regardless of what this returned, so
 * the UI uses it to warn BEFORE the wallet is invoked, never as the
 * enforcement itself.
 *
 * For `RhnToGlc` the UI nonetheless treats an unreadable answer as a
 * REFUSAL rather than a warning it can skip. That is not a claim to be the
 * enforcement — the backend still is — but a Robinhood deposit lands in
 * the custody contract with no `POST /transfers` preflight, so a blocked
 * one is not refused, it is folded and parked in `ManualReview` with the
 * user's funds already gone. "Unknown" must not authorize that.
 */
export const recipientEligibilitySchema = z.object({
  direction: directionSchema,
  /** The trimmed address the answer is about, echoed back by the backend. */
  address: z.string().min(1),
  /**
   * The base58 wallet this answer also checked, echoed back — `null` when
   * `?wallet=` was omitted (no wallet connected yet), distinct from "the
   * wallet leg was checked and found eligible."
   */
  wallet: z.string().nullable(),
  /** `true` only when NEITHER the recipient nor the source-wallet limit blocks. */
  eligible: z.boolean(),
  /**
   * Which limit is blocking, when `eligible` is `false`. `null` when
   * eligible. Wallet-first when both would block, matching the backend's
   * own fold precedence. The two limits are independently enforced by the
   * backend either way — this only decides which single message the UI
   * shows.
   */
  blocked_reason: z
    .enum(["source_wallet_rate_limited", "recipient_rate_limited"])
    .nullable(),
  /**
   * EVERY limit currently blocking, not just the one `blocked_reason`
   * surfaces — `[]` when eligible, both entries (source wallet first)
   * when both apply. Optional on the wire: a deployment predating the
   * field omits it, and an absent array is read as "not published", never
   * as "nothing is blocking" — `eligible`/`blocked_reason` remain the
   * verdict.
   */
  blocked_reasons: z
    .array(z.enum(["source_wallet_rate_limited", "recipient_rate_limited"]))
    .optional(),
  /** Absolute unix second the blocking window reopens; `null` when eligible. */
  retry_after: z.number().int().nullable(),
  /** The same instant as remaining seconds (>= 0); `null` when eligible. */
  retry_after_seconds: z.number().int().nonnegative().nullable(),
  /**
   * Per-limit reopen instants, so a caller showing a specific limit can
   * show that limit's own wait rather than the aggregate one. `null`
   * where that limit is not blocking, and — for the wallet leg — where
   * `?wallet=` was omitted and it was never evaluated.
   */
  source_wallet_retry_after: z.number().int().nullable().optional(),
  recipient_retry_after: z.number().int().nullable().optional(),
  /** The rolling window itself (86,400) — so copy/logic never hardcodes it. */
  window_seconds: z.number().int().positive(),
});

export type RecipientEligibilityDto = z.infer<typeof recipientEligibilitySchema>;

/**
 * One wallet's leg of the route-generic eligibility answer —
 * `WalletLegView` in the backend's `service/src/api.rs`.
 *
 * A leg is present only for a wallet the caller actually asked about. The
 * absence of a leg is the backend saying "I evaluated nothing here",
 * which is never the same as "I checked and it is clear" — see
 * {@link routeWalletEligibilitySchema}.
 */
export const walletLegSchema = z.object({
  /**
   * The address AS CANONICALIZED by the backend — the exact spelling the
   * ledger keys this wallet's window on, echoed so a caller racing form
   * edits can discard an answer about a superseded address.
   *
   * Canonical is not always the spelling that was sent: an EVM address
   * comes back lowercase however it was typed. The caller's stale-answer
   * check compares by address FORM for that reason
   * (`eligibilityMatchesInputs`), never as raw bytes of text.
   */
  address: z.string().min(1),
  /** `true` only when this wallet is outside its rolling window right now. */
  eligible: z.boolean(),
  /** The backend's machine-readable reason when blocked; `null` when clear. */
  reason: z.string().nullable().optional(),
  /** Absolute unix second the window reopens; `null` when not blocked. */
  retry_after: z.number().int().nullable().optional(),
  /** The same wait as seconds from `as_of` (>= 0); `null` when not blocked. */
  retry_after_seconds: z.number().int().nonnegative().nullable().optional(),
});

/**
 * `GET /routes/{route}/eligibility?source=<address>&destination=<address>`
 * — the route-generic rolling-24h wallet check, served for all six
 * routes (`RouteWalletEligibilityView`, service/src/api.rs).
 *
 * # The shape is the backend's, verified against it
 *
 * This schema was previously written against an EXPECTED endpoint
 * (`GET /eligibility?route=…`, with `source_eligibility` /
 * `destination_eligibility` objects beside string echoes). That endpoint
 * never shipped under that name or that shape. The one that did puts the
 * route in the PATH and answers with a nullable leg OBJECT per side. A
 * frontend holding the wrong contract cannot tell a 404 or a parse
 * failure from a real refusal, so it reported every route as
 * "temporarily unavailable" — which is exactly what this replaces.
 *
 * # An omitted leg is `null`, and `null` is not a clearance
 *
 * Each of `?source=`/`?destination=` is optional and at least one must be
 * given. A leg that was not asked about comes back `null` and was not
 * evaluated. Whether an unevaluated leg still blocks the transfer is not
 * decided here — it is decided by `normalizeRouteWalletEligibility` and
 * defaults to blocking; the sole exception is a route whose source wallet
 * cannot exist in the browser at all, which that module documents.
 *
 * # Deliberately minimal disclosure
 *
 * Per leg: a boolean, a reason and a reopen time. Never which request is
 * blocking, its amount, or anything else about the wallet's history.
 */
export const routeWalletEligibilitySchema = z.object({
  /** The route asked about, echoed in `Route::as_str` spelling. */
  route: z.string().min(1),
  /** The source leg, or `null` when `?source=` was omitted. */
  source: walletLegSchema.nullable(),
  /** The destination leg, or `null` when `?destination=` was omitted. */
  destination: walletLegSchema.nullable(),
  /** `true` only when NO evaluated leg is inside its window. */
  eligible: z.boolean(),
  /**
   * The single limit to show when one or both apply, source first. The
   * per-leg `reason` is what this UI renders; this is carried for
   * diagnostics and is deliberately NOT an enum — the backend's
   * vocabulary may grow, and a new spelling must not turn a real refusal
   * into a parse failure.
   */
  blocked_reason: z.string().nullable().optional(),
  /** EVERY blocking limit, source first; `[]` when eligible. */
  blocked_reasons: z.array(z.string()).optional(),
  /** The aggregate reopen instant for `blocked_reason`; `null` when eligible. */
  retry_after: z.number().int().nullable().optional(),
  /** The same instant as seconds from `as_of`; `null` when eligible. */
  retry_after_seconds: z.number().int().nonnegative().nullable().optional(),
  /** The rolling window itself (86,400) — so copy/logic never hardcodes it. */
  window_seconds: z.number().int().positive(),
  /** When the backend computed this, in unix seconds. */
  as_of: z.number().int().nullable().optional(),
});

export type WalletLegDto = z.infer<typeof walletLegSchema>;
export type RouteWalletEligibilityDto = z.infer<typeof routeWalletEligibilitySchema>;

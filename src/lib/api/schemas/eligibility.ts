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

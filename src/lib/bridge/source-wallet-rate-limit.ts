/**
 * Copy for the SolToGlc per-source-wallet rate limit: a connected Solana
 * wallet may make at most one qualifying deposit per rolling 24-hour
 * window (glc-solana-reserve-bridge docs/09-runbook.md) — the same rule
 * as `@/lib/bridge/recipient-rate-limit`'s per-recipient limit, keyed by
 * wallet instead of Goldcoin destination, enforced ALONGSIDE it (never
 * replacing it) so a single wallet cannot bypass the recipient limit by
 * spreading deposits across many different destination addresses.
 *
 * The verdict itself always comes from the backend
 * (`GET /recipients/sol-to-glc/eligibility`, `useSolToGlcRecipientEligibility`)
 * — nothing here re-implements the window; this module only renders what
 * the backend answered. The backend also remains the enforcing authority
 * at admission time, so this copy never claims to be the last line of
 * defense — it exists so the user is warned before their wallet is ever
 * opened for a deposit that would only be parked for manual review.
 *
 * Deliberately ONE sentence and nothing else, matching the recipient
 * limit's product decision: the blocked state shows exactly this line —
 * no retry-after time, no funds/next elaboration. The backend still
 * returns `retry_after`, and the pre-submit enforcement still uses the
 * full verdict; only the visible copy is reduced.
 */

export const SOURCE_WALLET_RATE_LIMIT_TITLE =
  "This Solana wallet has already used the bridge in the last 24 hours.";

import { z } from "zod";
import { directionSchema } from "./common";

/**
 * `RecipientEligibility` — `GET /recipients/sol-to-glc/eligibility`
 * (service/src/api.rs in glc-solana-reserve-bridge): whether the entered
 * Goldcoin destination address, and (when a wallet is connected) the
 * connected Solana source wallet, are currently eligible for a new
 * SolToGlc bridge payout — or one of them is still inside the backend's
 * rolling 24-hour window. Two INDEPENDENT limits, both enforced: a
 * Goldcoin recipient may receive at most one accepted payout per rolling
 * 24 hours, and a Solana source wallet may make at most one qualifying
 * deposit per rolling 24 hours, closing the bypass where one wallet
 * spreads deposits across many different recipients. Read-only and
 * advisory: the backend re-checks both rules authoritatively at admission
 * time regardless of what this returned, so the UI uses it purely to warn
 * BEFORE the wallet is invoked — never as the enforcement itself.
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
   * eligible. The two limits are independently enforced by the backend
   * either way — this only decides which single message the UI shows.
   */
  blocked_reason: z
    .enum(["source_wallet_rate_limited", "recipient_rate_limited"])
    .nullable(),
  /** Absolute unix second the blocking window reopens; `null` when eligible. */
  retry_after: z.number().int().nullable(),
  /** The same instant as remaining seconds (>= 0); `null` when eligible. */
  retry_after_seconds: z.number().int().nonnegative().nullable(),
  /** The rolling window itself (86,400) — so copy/logic never hardcodes it. */
  window_seconds: z.number().int().positive(),
});

export type RecipientEligibilityDto = z.infer<typeof recipientEligibilitySchema>;

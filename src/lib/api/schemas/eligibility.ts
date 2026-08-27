import { z } from "zod";
import { directionSchema } from "./common";

/**
 * `RecipientEligibility` — `GET /recipients/sol-to-glc/eligibility`
 * (service/src/api.rs in glc-solana-reserve-bridge): whether the entered
 * Goldcoin destination address is currently eligible for a new SolToGlc
 * bridge payout, or still inside the backend's rolling 24-hour
 * per-recipient window. Read-only and advisory: the backend re-checks the
 * same authoritative ledger rule at admission time regardless of what this
 * returned, so the UI uses it purely to warn BEFORE the wallet is invoked
 * — never as the enforcement itself.
 */
export const recipientEligibilitySchema = z.object({
  direction: directionSchema,
  /** The trimmed address the answer is about, echoed back by the backend. */
  address: z.string().min(1),
  eligible: z.boolean(),
  /** Absolute unix second the window reopens; `null` when eligible. */
  retry_after: z.number().int().nullable(),
  /** The same instant as remaining seconds (>= 0); `null` when eligible. */
  retry_after_seconds: z.number().int().nonnegative().nullable(),
  /** The rolling window itself (86,400) — so copy/logic never hardcodes it. */
  window_seconds: z.number().int().positive(),
});

export type RecipientEligibilityDto = z.infer<typeof recipientEligibilitySchema>;

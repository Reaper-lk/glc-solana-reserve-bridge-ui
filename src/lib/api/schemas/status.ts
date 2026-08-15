import { z } from "zod";
import { atomicAmountSchema } from "./common";

/** `GET /status` — `BridgeStatus` in service/src/api.rs. */
export const bridgeStatusSchema = z.object({
  goldcoin_paused: z.boolean(),
  solana_paused: z.boolean(),
  vault_address: z.string().min(1),
  next_solana_obligation_index: z.number().int().nonnegative(),
  glc_to_sol_available: z.boolean(),
  sol_to_glc_available: z.boolean(),
});

export type BridgeStatusDto = z.infer<typeof bridgeStatusSchema>;

/** `GET /reserve` — `ReserveAvailability`. Not clamped at zero (diagnostic). */
export const reserveAvailabilitySchema = z.object({
  goldcoin_available_capacity: z.number().int(),
  solana_available_capacity: z.number().int(),
});

export type ReserveAvailabilityDto = z.infer<typeof reserveAvailabilitySchema>;

/** `GET /health` — `PublicHealth`. Distinct from the operator-only ops health. */
export const publicHealthSchema = z.object({
  healthy: z.boolean(),
  goldcoin_indexer_halted: z.boolean(),
  manual_review_backlog: atomicAmountSchema,
  post_finality_reorg_events: z.number().int(),
});

export type PublicHealthDto = z.infer<typeof publicHealthSchema>;

/** `GET /limits` — `TransferLimits`. */
export const transferLimitsSchema = z.object({
  min_transfer_amount: atomicAmountSchema,
  per_transfer_limit: atomicAmountSchema,
  bridge_fee_bps: z.number().int().nonnegative(),
});

export type TransferLimitsDto = z.infer<typeof transferLimitsSchema>;

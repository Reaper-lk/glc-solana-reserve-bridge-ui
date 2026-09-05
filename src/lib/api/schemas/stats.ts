import { z } from "zod";
import {
  atomicAmountSchema,
  nonNegativeAtomicAmountSchema,
  unixSecondsSchema,
} from "./common";

const directionStatsSchema = z.object({
  total_requests: z.number().int().nonnegative(),
  in_progress_requests: z.number().int().nonnegative(),
  settled_requests: z.number().int().nonnegative(),
  manual_review_requests: z.number().int().nonnegative(),
});

const reserveStatsSchema = z.object({
  paused: z.boolean(),
  /** Signed: a capacity below zero is a real diagnostic state. */
  available_capacity: atomicAmountSchema,
  settled_volume_atomic: nonNegativeAtomicAmountSchema,
  accrued_fees_atomic: nonNegativeAtomicAmountSchema,
});

/** `GET /stats` — `BridgeStats` in service/src/api.rs. */
export const bridgeStatsSchema = z.object({
  goldcoin_paused: z.boolean(),
  solana_paused: z.boolean(),
  glc_to_sol_available: z.boolean(),
  sol_to_glc_available: z.boolean(),
  /** Same quota fields as `GET /status` — see status.ts for units. */
  glc_to_sol_quota_exhausted: z.boolean(),
  sol_to_glc_quota_exhausted: z.boolean(),
  glc_to_sol_rolling_volume_remaining: nonNegativeAtomicAmountSchema,
  sol_to_glc_rolling_volume_remaining: nonNegativeAtomicAmountSchema,
  bridge_fee_bps: z.number().int().nonnegative(),
  glc_to_sol: directionStatsSchema,
  sol_to_glc: directionStatsSchema,
  goldcoin_reserve: reserveStatsSchema,
  solana_reserve: reserveStatsSchema,
  goldcoin_indexer_halted: z.boolean(),
  goldcoin_indexer_seconds_since_tick: z.number().int(),
  solana_indexer_seconds_since_tick: z.number().int(),
  post_finality_reorg_events: z.number().int(),
  as_of: unixSecondsSchema,
});

export type BridgeStatsDto = z.infer<typeof bridgeStatsSchema>;
export type DirectionStatsDto = z.infer<typeof directionStatsSchema>;
export type ReserveStatsDto = z.infer<typeof reserveStatsSchema>;

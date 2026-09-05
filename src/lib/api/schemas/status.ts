import { z } from "zod";
import { atomicAmountSchema, nonNegativeAtomicAmountSchema } from "./common";

/** `GET /status` — `BridgeStatus` in service/src/api.rs. */
export const bridgeStatusSchema = z.object({
  goldcoin_paused: z.boolean(),
  solana_paused: z.boolean(),
  vault_address: z.string().min(1),
  next_solana_obligation_index: z.number().int().nonnegative(),
  glc_to_sol_available: z.boolean(),
  sol_to_glc_available: z.boolean(),
  /**
   * Rolling-24h-volume quota state, per direction (backend 2026-08-22
   * quota workflow). `quota_exhausted` means no transfer of any legal size
   * can currently succeed; `rolling_volume_remaining` is the raw headroom
   * still available in that direction's window, in the on-chain mint's
   * atomic units (6 decimals — the same unit the on-chain limit checks
   * use, see `programs/glc-reserve-bridge/src/limits.rs`). The backend
   * never auto-unpauses: once the operator pause engages, reopening is a
   * manual operator action.
   */
  glc_to_sol_quota_exhausted: z.boolean(),
  sol_to_glc_quota_exhausted: z.boolean(),
  glc_to_sol_rolling_volume_remaining: nonNegativeAtomicAmountSchema,
  sol_to_glc_rolling_volume_remaining: nonNegativeAtomicAmountSchema,
});

export type BridgeStatusDto = z.infer<typeof bridgeStatusSchema>;

/** `GET /reserve` — `ReserveAvailability`. Not clamped at zero (diagnostic). */
export const reserveAvailabilitySchema = z.object({
  goldcoin_available_capacity: atomicAmountSchema,
  solana_available_capacity: atomicAmountSchema,
});

export type ReserveAvailabilityDto = z.infer<typeof reserveAvailabilitySchema>;

/** `GET /health` — `PublicHealth`. Distinct from the operator-only ops health. */
export const publicHealthSchema = z.object({
  healthy: z.boolean(),
  goldcoin_indexer_halted: z.boolean(),
  /** A request COUNT, not an amount — bounded by rows, stays a number. */
  manual_review_backlog: z.number().int().nonnegative(),
  post_finality_reorg_events: z.number().int(),
});

export type PublicHealthDto = z.infer<typeof publicHealthSchema>;

/** `GET /limits` — `TransferLimits`. */
export const transferLimitsSchema = z.object({
  min_transfer_amount: nonNegativeAtomicAmountSchema,
  per_transfer_limit: nonNegativeAtomicAmountSchema,
  bridge_fee_bps: z.number().int().nonnegative(),
});

export type TransferLimitsDto = z.infer<typeof transferLimitsSchema>;

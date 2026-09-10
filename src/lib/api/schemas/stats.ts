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

/**
 * One executable route's configured fee — `RouteFeeView` in
 * `service/src/api.rs`.
 *
 * This is the authoritative answer to "what does this bridge charge for
 * THIS route". `BridgeStats::bridge_fee_bps` is not: the backend keeps it
 * under its historical name for wire compatibility and documents it as
 * `GlcToSol`'s rate alone, because a single field cannot express four
 * independently priced routes. Reading one route's number and showing it
 * beside another route's name is the display half of the bug the backend's
 * `crate::fees` closed in the pricing path.
 *
 * `route` is the wire spelling (`"GlcToRhn"`), left an open string so a
 * route this build cannot describe does not fail the whole response.
 */
const routeFeeSchema = z.object({
  route: z.string().min(1),
  fee_bps: z.number().int().nonnegative(),
  /**
   * Ready to display, e.g. `"3%"` — formatted by the same helper the
   * operator tooling uses, so this UI and the CLI can never round the
   * same rate differently. Rendered verbatim; never re-derived from
   * `fee_bps`.
   */
  fee_percent_display: z.string().min(1),
});

export type RouteFeeDto = z.infer<typeof routeFeeSchema>;

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
  /**
   * `GlcToSol`'s rate, under its historical name. NOT a bridge-wide fee —
   * read {@link bridgeStatsSchema}'s `route_fees` instead.
   */
  bridge_fee_bps: z.number().int().nonnegative(),
  /**
   * Every executable route's configured fee, in registry order.
   *
   * OPTIONAL on the wire and deliberately not defaulted: a deployment
   * predating the per-route fee table omits it, and an absent table means
   * "this backend does not publish per-route pricing" — which a consumer
   * reports as unpublished rather than filling in from `bridge_fee_bps`.
   */
  route_fees: z.array(routeFeeSchema).optional(),
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

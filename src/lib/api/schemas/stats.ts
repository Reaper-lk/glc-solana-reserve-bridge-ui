import { z } from "zod";
import {
  atomicAmountSchema,
  nonNegativeAtomicAmountSchema,
  unixSecondsSchema,
} from "./common";
import { isRobinhoodAvailable } from "./robinhood";

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
 * `GET /stats`' Robinhood member — the THIRD reserve, reported alongside
 * the Goldcoin and Solana ones as of backend PR #79.
 *
 * # Why this is not {@link reserveStatsSchema}
 *
 * It carries the same four figures, and every one of them is NULLABLE
 * where the other two reserves' are not. That is the whole difference and
 * it is load-bearing: a deployment with no `[reserve.robinhood]` section
 * has no reserve to report, so the backend sends
 * `ledger_availability: "not_configured"` and `null` for the rest rather
 * than a zero it would be inventing. Widening `reserveStatsSchema` to
 * cover both would make Goldcoin's and Solana's figures nullable too, and
 * the absent/empty distinction those two do not need is exactly the one
 * this reserve does.
 *
 * # `null` is never `0`
 *
 * `0` is a real balance — an empty reserve that exists. `null` is "there
 * is no reserve here to ask about". Rendering the second as the first
 * publishes a balance the bridge explicitly declined to claim, which is
 * the same rule `./robinhood` states for `GET /robinhood/reserve` and the
 * reason both endpoints spell absence the same way.
 *
 * # `ledger_availability` reuses `./robinhood`'s vocabulary
 *
 * It is the same `crate::robinhood::public` constant `GET /robinhood/
 * reserve` publishes under the same field name, so it is read with the
 * same {@link isRobinhoodAvailable} predicate — open string, fail-closed
 * for any spelling this build does not know, amounts strictly validated
 * either way. There is deliberately no second, `/stats`-only notion of
 * "available" anywhere in this app.
 */
const robinhoodReserveStatsSchema = z.object({
  /** `"available"` only when a `reserve_ledger` row exists for this reserve. */
  ledger_availability: z.string().min(1),
  /** This reserve's own operator pause. `null` when there is no reserve. */
  paused: z.boolean().nullable(),
  /**
   * CANONICAL 8-decimal units, like the rest of this reserve's ledger
   * figures and unlike the custody contract's native 18 — the ledger
   * column is an `INTEGER` and cannot hold the latter (see `./robinhood`).
   *
   * Signed for the same reason the other two reserves' are: a capacity
   * below zero is a real diagnostic state, not something to clamp away.
   */
  available_capacity: atomicAmountSchema.nullable(),
  settled_volume_atomic: nonNegativeAtomicAmountSchema.nullable(),
  accrued_fees_atomic: nonNegativeAtomicAmountSchema.nullable(),
});

export type RobinhoodReserveStatsDto = z.infer<typeof robinhoodReserveStatsSchema>;

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
  /**
   * The Robinhood reserve — see {@link robinhoodReserveStatsSchema}.
   *
   * OPTIONAL on the wire and deliberately not defaulted, for the same
   * reason `route_fees` is: a deployment predating backend PR #79 omits
   * the member entirely, and an ABSENT member means "this backend does not
   * publish a Robinhood reserve" — which is a different fact from the
   * member arriving with `ledger_availability: "not_configured"`, which
   * means "this backend publishes one and there is none configured". A
   * synthesised `not_configured` default would erase that difference, and
   * a zero-filled default would invent a balance.
   */
  robinhood_reserve: robinhoodReserveStatsSchema.optional(),
  goldcoin_indexer_halted: z.boolean(),
  goldcoin_indexer_seconds_since_tick: z.number().int(),
  solana_indexer_seconds_since_tick: z.number().int(),
  post_finality_reorg_events: z.number().int(),
  as_of: unixSecondsSchema,
});

export type BridgeStatsDto = z.infer<typeof bridgeStatsSchema>;
export type DirectionStatsDto = z.infer<typeof directionStatsSchema>;
export type ReserveStatsDto = z.infer<typeof reserveStatsSchema>;

/**
 * The Robinhood reserve's `/stats` figures when — and only when — they are
 * REAL ones.
 *
 * Returns `null` for every case in which the backend declined to state a
 * balance: the member is absent (a backend predating it), the ledger is
 * `not_configured`/`unavailable`/any spelling this build does not know, or
 * the capacity itself came back `null`. A caller renders that as an
 * explicit unavailable state; there is no branch here, and must be none
 * anywhere downstream, that turns any of it into `0`.
 *
 * `paused` stays nullable in the result on purpose: a live ledger row with
 * no pause flag is genuinely unknown, and "not paused" would be a claim
 * about an operator action nobody reported.
 */
export interface RobinhoodReserveLedger {
  readonly paused: boolean | null;
  /** Exact canonical-unit atomic string. Signed; never clamped here. */
  readonly available_capacity: string;
  readonly settled_volume_atomic: string | null;
  readonly accrued_fees_atomic: string | null;
}

export function robinhoodReserveLedger(
  stats: BridgeStatsDto | undefined,
): RobinhoodReserveLedger | null {
  const member = stats?.robinhood_reserve;
  if (!member) return null;
  if (!isRobinhoodAvailable(member.ledger_availability)) return null;
  if (member.available_capacity === null) return null;
  return {
    paused: member.paused,
    available_capacity: member.available_capacity,
    settled_volume_atomic: member.settled_volume_atomic,
    accrued_fees_atomic: member.accrued_fees_atomic,
  };
}

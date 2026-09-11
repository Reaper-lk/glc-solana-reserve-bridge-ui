import { z } from "zod";
import { routeViewSchema } from "./chains";
import {
  atomicAmountSchema,
  nonNegativeAtomicAmountSchema,
  unixSecondsSchema,
} from "./common";

/**
 * `GET /robinhood/reserve` — the Robinhood reserve, reported by the backend
 * as a THIRD INDEPENDENT reserve (`RobinhoodReserveView` in
 * `service/src/api.rs`).
 *
 * # Why this is not part of `GET /reserve`
 *
 * `GET /reserve` publishes the Goldcoin and Solana capacities and was
 * deliberately left untouched when Robinhood arrived: these are different
 * physical pools on different chains and one cannot cover the other. The
 * backend refuses to sum, difference or default one from another, and so
 * does this UI — nothing here is ever substituted for a Goldcoin or Solana
 * figure, or vice versa.
 *
 * # Absent is not zero, and this schema is what enforces that
 *
 * Every ledger figure is nullable, and `null` means "this deployment has no
 * `[reserve.robinhood]` section, so there is no reserve to report" — never
 * "the reserve is empty". Every contract figure is nullable for the
 * matching reason: `availability` is `"unavailable"` when the read did not
 * complete and `"not_configured"` when there is no contract to ask, and in
 * both cases the backend sends nulls rather than a service-side copy. A
 * consumer that renders a `null` as `0` would be publishing a balance the
 * bridge explicitly declined to claim.
 *
 * # Why the availability fields are open strings
 *
 * They carry one of three constants (`crate::robinhood::public`), but they
 * are STATUS descriptors rather than records of money that has already
 * moved. A fourth spelling added backend-side must degrade to "not
 * available" — which is what {@link isRobinhoodAvailable} returns for
 * anything that is not the exact `"available"` literal — rather than
 * failing the whole response and taking the status page down with it. The
 * amounts stay strictly validated; only the verdict is permissive, and it
 * is permissive in the fail-closed direction.
 */

/** `crate::robinhood::public::AVAILABILITY_AVAILABLE`. The only value that means "these numbers are real". */
export const ROBINHOOD_AVAILABLE = "available";
/** No `[reserve.robinhood]` / `[robinhood.settlement]` section on this deployment. */
export const ROBINHOOD_NOT_CONFIGURED = "not_configured";
/** Configured, but the live read did not complete. Every figure is null. */
export const ROBINHOOD_UNAVAILABLE = "unavailable";

/**
 * Whether an availability verdict means the figures beside it came from a
 * real read. Fails closed for any value this build does not know.
 */
export function isRobinhoodAvailable(availability: string): boolean {
  return availability === ROBINHOOD_AVAILABLE;
}

/**
 * One direction's rolling-window consumption, exactly as the custody
 * contract accounts for it — Robinhood's native 18 decimals, not the
 * canonical 8 the ledger figures above use. The two units appear on the
 * same route and must never be formatted with each other's decimals.
 */
export const robinhoodWindowSchema = z.object({
  limit_atomic: nonNegativeAtomicAmountSchema,
  used_atomic: nonNegativeAtomicAmountSchema,
  /** `limit - used`, already saturated at zero by the backend. */
  remaining_atomic: nonNegativeAtomicAmountSchema,
  /** Unix seconds at which this bucket expires and the full limit returns. */
  resets_at: unixSecondsSchema,
  /**
   * Whether the recorded bucket is the one `as_of` falls in. `false` means
   * it has rolled over and `used_atomic` is `0` for that reason — a real
   * figure, not a placeholder.
   */
  is_current: z.boolean(),
});

export type RobinhoodWindowDto = z.infer<typeof robinhoodWindowSchema>;

/** The custody contract's own view, in its native 18-decimal units. */
export const robinhoodOnchainSchema = z.object({
  availability: z.string().min(1),
  encumbered_reserve_atomic: nonNegativeAtomicAmountSchema.nullable(),
  protected_min_reserve_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** Governance's inbound kill switch (`depositsPaused()`). */
  deposits_paused: z.boolean().nullable(),
  /** The outbound one (`payoutsPaused()`). Separate on-chain, so separate here. */
  payouts_paused: z.boolean().nullable(),
  /** The DEPOSIT direction's rolling 24h window — the `RhnToGlc` source leg. */
  inbound_window: robinhoodWindowSchema.nullable(),
  /** The PAYOUT direction's — the `GlcToRhn` destination leg. */
  outbound_window: robinhoodWindowSchema.nullable(),
  window_seconds: z.number().int().nonnegative().nullable(),
});

export type RobinhoodOnchainDto = z.infer<typeof robinhoodOnchainSchema>;

/**
 * The Robinhood deposit indexer's liveness, in the same non-sensitive
 * register as `GET /health`: never an RPC URL, a host or a chain id.
 */
export const robinhoodIndexerSchema = z.object({
  /** `false` when this deployment has no `[robinhood.indexer]` section. */
  configured: z.boolean(),
  /** Whether the LAST attempted tick reached the endpoint. */
  connected: z.boolean(),
  lag_blocks: z.number().int().nonnegative().nullable(),
  last_success_at: unixSecondsSchema.nullable(),
  /** Stopped for a condition requiring an operator. Pauses no reserve. */
  halted: z.boolean(),
});

export type RobinhoodIndexerDto = z.infer<typeof robinhoodIndexerSchema>;

export const robinhoodReserveSchema = z.object({
  /** `"available"` only when a `reserve_ledger` row exists. */
  ledger_availability: z.string().min(1),
  /**
   * CANONICAL 8-decimal units — deliberately NOT Robinhood's native 18.
   * The ledger column is an `INTEGER` and cannot hold an 18-decimal
   * amount, so the backend keeps this reserve's books in canonical units
   * and reports the contract's 18-decimal figures separately under
   * `onchain`. Formatting either with the other's decimals is wrong by ten
   * orders of magnitude.
   */
  balance_atomic: nonNegativeAtomicAmountSchema.nullable(),
  protected_minimum_atomic: nonNegativeAtomicAmountSchema.nullable(),
  reserved_liquidity_atomic: nonNegativeAtomicAmountSchema.nullable(),
  pending_obligations_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** Signed: a capacity below zero is a real diagnostic state, not clamped. */
  available_capacity_atomic: atomicAmountSchema.nullable(),
  accrued_fees_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** This reserve's own pause flag. `null` when unconfigured. */
  paused: z.boolean().nullable(),
  onchain: robinhoodOnchainSchema,
  /**
   * The same `RouteGate` verdict `GET /chains` publishes for the two
   * Robinhood routes, repeated here so a client need not correlate two
   * responses. `GET /chains` remains the availability authority for the
   * app as a whole; this is the same answer, not a second one.
   */
  routes: z.array(routeViewSchema),
  indexer: robinhoodIndexerSchema,
  as_of: unixSecondsSchema,
});

export type RobinhoodReserveDto = z.infer<typeof robinhoodReserveSchema>;

/**
 * `GET /robinhood/limits` — the per-transfer and rolling ceilings the
 * deployed `GlcRobinhoodBridge` actually enforces
 * (`RobinhoodLimitsView` in `service/src/api.rs`).
 *
 * # Why this is not `GET /limits`
 *
 * `GET /limits` reports the SOLANA program's `BridgeConfig`. Those
 * figures bound Solana releases in that mint's own 6-decimal units; they
 * are not enforced on Robinhood, and relabelling them for a Robinhood
 * route would publish a ceiling neither chain applies. The backend keeps
 * the two endpoints separate for exactly that reason, and so does this
 * schema.
 *
 * # Unknown is reported as unknown
 *
 * Every limit is `null` unless `availability` is `"available"`. The
 * backend holds no service-side copy to substitute — `[robinhood.
 * settlement]` carries no min, max or rolling limit — so a null here
 * means "not read", never "no limit". A consumer that rendered one as
 * "unlimited" would be inventing a permission the contract never gave.
 *
 * # Units
 *
 * Robinhood's native 18 decimals, decimal strings — NOT the canonical 8
 * the ledger figures use. The two differ by an exact factor of 10^10 and
 * formatting either with the other's decimals is wrong by ten orders of
 * magnitude.
 */
export const robinhoodLimitsSchema = z.object({
  /** One of the three availability constants above. */
  availability: z.string().min(1),
  /** Smallest accepted DEPOSIT — the `RhnToGlc` source leg. */
  inbound_min_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** `limits().inboundMax`: the largest accepted deposit. */
  inbound_max_atomic: nonNegativeAtomicAmountSchema.nullable(),
  inbound_rolling_limit_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** Smallest PAYOUT — the `GlcToRhn` destination leg. */
  outbound_min_atomic: nonNegativeAtomicAmountSchema.nullable(),
  /** `limits().outboundMax`: the largest payout the contract will make. */
  outbound_max_atomic: nonNegativeAtomicAmountSchema.nullable(),
  outbound_rolling_limit_atomic: nonNegativeAtomicAmountSchema.nullable(),
  protected_min_reserve_atomic: nonNegativeAtomicAmountSchema.nullable(),
  rolling_window_seconds: z.number().int().nonnegative().nullable(),
  /**
   * `RhnToGlc`'s rolling window: the contract's INBOUND accumulator, the
   * one `deposit()` charges against `inboundRollingLimit`. Its
   * `remaining_atomic` is the authoritative answer to "how much more may
   * move on this route in this window" — the same projection
   * `GET /robinhood/reserve` publishes as `onchain.inbound_window`, from
   * the same backend helper, so the two endpoints cannot disagree.
   *
   * Keyed by ROUTE rather than by contract direction on purpose: pairing
   * an inbound figure with an outbound route is the one mistake this
   * shape exists to make impossible, and the name is now the mapping.
   *
   * The charged quantity is the DEPOSIT amount, which is exactly what a
   * user types on `RhnToGlc` — the fee is taken later, on the Goldcoin
   * side — so this needs no fee adjustment to be comparable with the
   * amount field.
   */
  rhn_to_glc_rolling_window: robinhoodWindowSchema.nullish(),
  /**
   * `GlcToRhn`'s rolling window: the contract's OUTBOUND accumulator,
   * charged by `executePayout` against `outboundRollingLimit`.
   *
   * # This one is denominated in NET
   *
   * `executePayout` consumes `req.amount`, the payout this service makes
   * AFTER `GlcToRhn`'s fee — not the gross a user spends on the Goldcoin
   * side. Rendered beside a gross amount field it therefore understates
   * the spendable headroom slightly, which is the safe direction;
   * grossing it up would publish capacity the contract would refuse.
   */
  glc_to_rhn_rolling_window: robinhoodWindowSchema.nullish(),
  /**
   * The bridge fee rate in basis points. NOT read from the contract: it
   * is the service's own fixed protocol constant, the same rate
   * `GET /limits` reports. Present even when `availability` is not
   * `"available"`, because it is known without reaching the chain.
   *
   * Retained under its historical name and equal to
   * {@link robinhoodLimitsSchema.shape.rhn_to_glc_fee_bps}. Prefer the
   * per-route fields below: the two routes' rates are configured
   * separately and a deployment can hold different ones.
   */
  bridge_fee_bps: z.number().int().nonnegative(),
  /** `GlcToRhn`'s configured rate, charged when the request is created. */
  glc_to_rhn_fee_bps: z.number().int().nonnegative(),
  /** `RhnToGlc`'s configured rate, charged at fold time. */
  rhn_to_glc_fee_bps: z.number().int().nonnegative(),
  as_of: unixSecondsSchema,
});

export type RobinhoodLimitsDto = z.infer<typeof robinhoodLimitsSchema>;

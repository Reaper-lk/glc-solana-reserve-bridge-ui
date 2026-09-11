import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "../schemas/status";
import type { BridgeStatsDto } from "../schemas/stats";
import type { RobinhoodReserveDto } from "../schemas/robinhood";
import { ROBINHOOD_AVAILABLE, ROBINHOOD_NOT_CONFIGURED } from "../schemas/robinhood";
import type { ChainsViewDto } from "../schemas/chains";
import type { ExplorerEventDto } from "../schemas/explorer";
import type { ReserveHistoryEntryDto } from "../schemas/reserves";
import type { TransferViewDto, RefundViewDto, RequestState } from "../schemas/transfer";
import { isRefundState } from "@/lib/bridge";

/**
 * Typed in-repo fixtures for `NEXT_PUBLIC_BRIDGE_API_MODE=mock`.
 *
 * Shapes mirror the real backend (`service/src/api.rs`) exactly, including
 * its unhappy paths — a paused direction, insufficient liquidity, a
 * `ManualReview` transfer — so those states are exercised in development
 * without a live backend.
 */

const NOW_UNIX = () => Math.floor(Date.now() / 1000);

// The real production rate (`amount_conversion::BRIDGE_FEE_BPS`,
// glc-solana-reserve-bridge) is 300 bps (3%) as of the 2026-08-29 limits
// update (earlier: 6%, and 1% in the pilot) — kept in lockstep here so
// `NEXT_PUBLIC_BRIDGE_API_MODE=mock` exercises the same math real users
// see.
export const BRIDGE_FEE_BPS = 300;

/**
 * The Robinhood routes' own rate, deliberately DIFFERENT from
 * {@link BRIDGE_FEE_BPS}.
 *
 * The backend prices routes independently (`BridgeStats::route_fees`) and
 * documents `bridge_fee_bps` as `GlcToSol`'s rate alone. Giving both
 * families the same number in the fixtures would make a UI that showed the
 * Solana rate on a Robinhood card indistinguishable from a correct one, in
 * mock mode and in every test built on these fixtures. A distinct value is
 * what makes that substitution visible.
 */
export const ROBINHOOD_FEE_BPS = 250;

/**
 * Quota fields are in the on-chain mint's atomic units (6 decimals), the
 * unit the on-chain rolling window records — NOT the canonical 8-decimal
 * unit gross/fee/net figures use. Full pilot window: 100,000 GLC per
 * direction (docs/09-runbook.md 2026-08-22); the operational fixture shows
 * a partially consumed GlcToSol window (17,500 GLC remaining, matching the
 * approved display example) and an untouched SolToGlc window.
 */
export function statusFixture(now: () => Date): BridgeStatusDto {
  void now;
  return {
    goldcoin_paused: false,
    solana_paused: false,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 42,
    glc_to_sol_available: true,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "17500000000",
    sol_to_glc_rolling_volume_remaining: "100000000000",
  };
}

export function pausedStatusFixture(): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: true,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 42,
    glc_to_sol_available: false,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "17500000000",
    sol_to_glc_rolling_volume_remaining: "100000000000",
  };
}

/**
 * GlcToSol's rolling window exhausted (remaining below the 100-GLC
 * minimum) but the operator pause not yet engaged — the brief
 * quota-only state before the backend's background tick pauses the
 * direction. SolToGlc stays fully usable.
 */
export function quotaExhaustedStatusFixture(): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: false,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 42,
    glc_to_sol_available: false,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: true,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "40000000",
    sol_to_glc_rolling_volume_remaining: "100000000000",
  };
}

/**
 * The steady refill-wait state: quota exhausted AND the operator pause
 * engaged (never auto-cleared) while reserves are replenished.
 */
export function quotaPausedStatusFixture(): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: true,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 42,
    glc_to_sol_available: false,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: true,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "0",
    sol_to_glc_rolling_volume_remaining: "100000000000",
  };
}

/**
 * `GET /chains`, in the state a real deployment actually serves today.
 *
 * Mirrors the backend's own resolved defaults exactly
 * (`Route::default_enabled` + the Robinhood adapter's capability):
 *
 * - `GlcToSol`/`SolToGlc` — enabled. They predate the route registry and
 *   resolve to enabled against an unmodified config and an unmigrated
 *   ledger, which is why existing behaviour is unchanged.
 * - `GlcToRhn`/`RhnToGlc` — implemented, DISABLED. The settlement
 *   machinery exists (Phase F); the routes ship closed and opening one
 *   needs every gate, this service's and the contract's.
 * - `SolToRhn`/`RhnToSol` — `implemented: false`. Structurally
 *   non-executable: no `Direction` value exists for either, so no
 *   settlement function can be called with them at all.
 *
 * The disabled copy is the backend's `RouteGateError::UNAVAILABLE_MESSAGE`
 * verbatim, so what mock mode renders is what production renders.
 */
export const ROUTE_UNAVAILABLE_MESSAGE =
  "This route is not available yet.\nRobinhood Network support is in development and " +
  "cannot be used for transfers.";

/**
 * The backend's own cause-agnostic copy for a route that is switched on
 * and still refused by a runtime gate on its destination reserve
 * (`DIRECTION_UNAVAILABLE_MESSAGE` in api.rs, reused verbatim by
 * `route_availability`). Deliberately identical to what a 409 carries:
 * which gate closed is an operator detail this endpoint never discloses.
 */
export const DIRECTION_UNAVAILABLE_MESSAGE =
  "Bridge capacity reached for this direction.";

export function chainsFixture(
  now: () => Date,
  options: {
    readonly robinhoodOpen?: boolean;
    /**
     * The `available` half of backend PR #76, independently of `enabled`.
     * Defaults to `robinhoodOpen`, so the ordinary fixtures describe a
     * coherent backend; setting it `false` while `robinhoodOpen` is
     * `true` reproduces the exact production state that made the two
     * fields necessary — the route gate open, the Goldcoin reserve's
     * admission closed.
     */
    readonly robinhoodAvailable?: boolean;
  } = {},
): ChainsViewDto {
  // Mock-only. Never a claim that these routes are open in production —
  // it exists so the Robinhood flows can be exercised end to end against
  // a route the real backend keeps closed.
  const robinhoodOpen = options.robinhoodOpen ?? false;
  const robinhoodAvailable =
    (options.robinhoodAvailable ?? robinhoodOpen) && robinhoodOpen;
  const robinhood = (id: "GlcToRhn" | "RhnToGlc"): ChainsViewDto["routes"][number] => ({
    id,
    source_chain: id === "GlcToRhn" ? "goldcoin" : "robinhood",
    destination_chain: id === "GlcToRhn" ? "robinhood" : "goldcoin",
    enabled: robinhoodOpen,
    disabled_reason: robinhoodOpen ? null : ROUTE_UNAVAILABLE_MESSAGE,
    implemented: true,
    available: robinhoodAvailable,
    unavailable_reason: robinhoodAvailable
      ? null
      : robinhoodOpen
        ? DIRECTION_UNAVAILABLE_MESSAGE
        : ROUTE_UNAVAILABLE_MESSAGE,
  });

  return {
    chains: [
      { id: "goldcoin", display_name: "Goldcoin L1" },
      { id: "solana", display_name: "Solana" },
      { id: "robinhood", display_name: "Robinhood Network" },
    ],
    routes: [
      {
        id: "GlcToSol",
        source_chain: "goldcoin",
        destination_chain: "solana",
        enabled: true,
        disabled_reason: null,
        implemented: true,
        available: true,
        unavailable_reason: null,
      },
      {
        id: "SolToGlc",
        source_chain: "solana",
        destination_chain: "goldcoin",
        enabled: true,
        disabled_reason: null,
        implemented: true,
        available: true,
        unavailable_reason: null,
      },
      robinhood("GlcToRhn"),
      robinhood("RhnToGlc"),
      {
        id: "SolToRhn",
        source_chain: "solana",
        destination_chain: "robinhood",
        enabled: false,
        disabled_reason: ROUTE_UNAVAILABLE_MESSAGE,
        implemented: false,
        // A route with no settlement machinery can admit nothing, and the
        // backend answers `available: false` for it before it looks at any
        // reserve at all.
        available: false,
        unavailable_reason: ROUTE_UNAVAILABLE_MESSAGE,
      },
      {
        id: "RhnToSol",
        source_chain: "robinhood",
        destination_chain: "solana",
        enabled: false,
        disabled_reason: ROUTE_UNAVAILABLE_MESSAGE,
        implemented: false,
        available: false,
        unavailable_reason: ROUTE_UNAVAILABLE_MESSAGE,
      },
    ],
    as_of: Math.floor(now().getTime() / 1000),
  };
}

/**
 * `GET /robinhood/reserve`, in the two states that actually exist.
 *
 * # The default is "not configured", and that is not a placeholder
 *
 * No production deployment carries a `[reserve.robinhood]` section today,
 * so the real endpoint answers `ledger_availability: "not_configured"`
 * with every ledger figure `null`, an unread contract, and an
 * unconfigured indexer. Mock mode says the same thing rather than
 * inventing a reserve that does not exist — "absent is not zero" is the
 * property this fixture has to preserve, not paper over.
 *
 * # The open state's units
 *
 * The ledger figures are CANONICAL 8-decimal amounts (the backend keeps
 * this reserve's books in canonical units because its ledger column is an
 * `INTEGER`); the contract's window figures are Robinhood's native 18.
 * The two appear on the same route, so the fixture carries both at their
 * real precision — a mock that used one unit for both would hide exactly
 * the bug that discipline exists to prevent.
 *
 * Every number below is a MOCK value chosen to be obviously
 * non-production, never a real balance, limit or fee.
 */
export interface RobinhoodReserveFixtureOptions {
  /** Report both Robinhood routes open, as `MockScenario` "robinhood-open" does. */
  readonly open?: boolean;
  /** The reserve's own operator pause. */
  readonly paused?: boolean;
  /** The contract's outbound (payout) kill switch — the `GlcToRhn` leg. */
  readonly payoutsPaused?: boolean;
  /** The contract's inbound (deposit) kill switch — the `RhnToGlc` leg. */
  readonly depositsPaused?: boolean;
  /** Simulate an indexer that has halted for operator attention. */
  readonly indexerHalted?: boolean;
}

export function robinhoodReserveFixture(
  now: () => Date,
  options: RobinhoodReserveFixtureOptions = {},
): RobinhoodReserveDto {
  const asOf = Math.floor(now().getTime() / 1000);
  const routes = chainsFixture(now, {
    robinhoodOpen: options.open ?? false,
  }).routes.filter((route) => route.id === "GlcToRhn" || route.id === "RhnToGlc");

  if (!options.open) {
    // Exactly what the live endpoint returns on a deployment with no
    // `[reserve.robinhood]` section: nulls, not zeroes.
    return {
      ledger_availability: ROBINHOOD_NOT_CONFIGURED,
      balance_atomic: null,
      protected_minimum_atomic: null,
      reserved_liquidity_atomic: null,
      pending_obligations_atomic: null,
      available_capacity_atomic: null,
      accrued_fees_atomic: null,
      paused: null,
      onchain: {
        availability: ROBINHOOD_NOT_CONFIGURED,
        encumbered_reserve_atomic: null,
        protected_min_reserve_atomic: null,
        deposits_paused: null,
        payouts_paused: null,
        inbound_window: null,
        outbound_window: null,
        window_seconds: null,
      },
      routes,
      indexer: {
        configured: false,
        connected: false,
        lag_blocks: null,
        last_success_at: null,
        halted: false,
      },
      as_of: asOf,
    };
  }

  return {
    ledger_availability: ROBINHOOD_AVAILABLE,
    // Canonical 8dp. balance - protected - reserved = available capacity,
    // computed here rather than asserted, so the fixture cannot drift into
    // an arithmetic state the backend could never produce.
    balance_atomic: "217300000000000",
    protected_minimum_atomic: "5000000000000",
    reserved_liquidity_atomic: "300000000000",
    pending_obligations_atomic: "120000000000",
    available_capacity_atomic: "212000000000000",
    accrued_fees_atomic: "2120000000000",
    paused: options.paused ?? false,
    onchain: {
      availability: ROBINHOOD_AVAILABLE,
      // Robinhood 18dp from here down.
      encumbered_reserve_atomic: "53000000000000000000000",
      protected_min_reserve_atomic: "50000000000000000000000",
      deposits_paused: options.depositsPaused ?? false,
      payouts_paused: options.payoutsPaused ?? false,
      inbound_window: {
        limit_atomic: "100000000000000000000000",
        used_atomic: "0",
        remaining_atomic: "100000000000000000000000",
        resets_at: asOf + 3_600,
        is_current: true,
      },
      outbound_window: {
        limit_atomic: "100000000000000000000000",
        used_atomic: "38750000000000000000000",
        remaining_atomic: "61250000000000000000000",
        resets_at: asOf + 3_600,
        is_current: true,
      },
      window_seconds: 86_400,
    },
    routes,
    indexer: {
      configured: true,
      connected: !options.indexerHalted,
      lag_blocks: options.indexerHalted ? null : 2,
      last_success_at: asOf - (options.indexerHalted ? 900 : 6),
      halted: options.indexerHalted ?? false,
    },
    as_of: asOf,
  };
}

export function limitsFixture(): TransferLimitsDto {
  // Real production values (2026-08-29 limits update,
  // docs/22-production-readiness-review.md), in the unit `/limits`
  // actually carries: the on-chain `BridgeConfig` values raw, which the
  // on-chain checks compare against MINT-atomic (6-decimal) amounts
  // (limits.rs::enforce_transfer_amount) — `min_transfer_amount` is the
  // live 99 GLC NET-side floor (`release_from_reserve` checks the net
  // amount), `per_transfer_limit` is the 20,000 GLC gross maximum. The
  // UI's own GROSS-side entry floor (102.061856 GLC at the 3% fee) is
  // computed from these figures together with `bridge_fee_bps`
  // (`minimumGrossCanonicalForMinTransferAmount`), never hardcoded, so
  // there is no fixed "rounder" constant to keep in sync here.
  return {
    min_transfer_amount: "99000000",
    per_transfer_limit: "20000000000",
    bridge_fee_bps: BRIDGE_FEE_BPS,
  };
}

export function reserveFixture(): ReserveAvailabilityDto {
  return {
    goldcoin_available_capacity: "425000000000000",
    solana_available_capacity: "398000000000000",
  };
}

export function insufficientReserveFixture(): ReserveAvailabilityDto {
  return {
    goldcoin_available_capacity: "425000000000000",
    solana_available_capacity: "5000000000",
  };
}

export function healthFixture(): PublicHealthDto {
  return {
    healthy: true,
    goldcoin_indexer_halted: false,
    manual_review_backlog: 0,
    post_finality_reorg_events: 0,
  };
}

/**
 * Mock `GET /stats`.
 *
 * `robinhoodOpen` mirrors {@link robinhoodReserveFixture}'s `open`, and the
 * mock client passes the same `MockScenario === "robinhood-open"` to both:
 * a mock backend that called the Robinhood reserve configured on `/stats`
 * and unconfigured on `/robinhood/reserve` would be describing a state no
 * real deployment can be in.
 *
 * Default is the unconfigured one, and — exactly as for
 * {@link robinhoodReserveFixture} — that is not a placeholder but what a
 * deployment with no `[reserve.robinhood]` section really answers: NULLS,
 * never zeroes.
 */
export interface StatsFixtureOptions {
  /** Report a live Robinhood reserve ledger row, as "robinhood-open" does. */
  readonly robinhoodOpen?: boolean;
}

export function statsFixture(options: StatsFixtureOptions = {}): BridgeStatsDto {
  return {
    goldcoin_paused: false,
    solana_paused: false,
    glc_to_sol_available: true,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "17500000000",
    sol_to_glc_rolling_volume_remaining: "100000000000",
    bridge_fee_bps: BRIDGE_FEE_BPS,
    // `GlcToSol`'s rate under its historical name above; the per-route
    // table is the authoritative one. `SolToRhn`/`RhnToSol` are absent
    // because the backend builds this from the EXECUTABLE routes only.
    route_fees: [
      { route: "GlcToSol", fee_bps: BRIDGE_FEE_BPS, fee_percent_display: "3%" },
      { route: "SolToGlc", fee_bps: BRIDGE_FEE_BPS, fee_percent_display: "3%" },
      { route: "GlcToRhn", fee_bps: ROBINHOOD_FEE_BPS, fee_percent_display: "2.50%" },
      { route: "RhnToGlc", fee_bps: ROBINHOOD_FEE_BPS, fee_percent_display: "2.50%" },
    ],
    glc_to_sol: {
      total_requests: 1284,
      in_progress_requests: 6,
      settled_requests: 1250,
      manual_review_requests: 2,
    },
    sol_to_glc: {
      total_requests: 968,
      in_progress_requests: 4,
      settled_requests: 951,
      manual_review_requests: 1,
    },
    goldcoin_reserve: {
      paused: false,
      available_capacity: "425000000000000",
      settled_volume_atomic: "8240000000000000",
      accrued_fees_atomic: "82400000000000",
    },
    solana_reserve: {
      paused: false,
      available_capacity: "398000000000000",
      settled_volume_atomic: "6110000000000000",
      accrued_fees_atomic: "61100000000000",
    },
    // The third reserve, backend PR #79. Its figures are CANONICAL
    // 8-decimal amounts like the Goldcoin member's — never the custody
    // contract's native 18, which only `/robinhood/reserve`'s `onchain`
    // block uses. Every one of them is `null` when there is no reserve,
    // which is the property this fixture exists to preserve rather than
    // paper over: a zero would claim an empty reserve that exists.
    robinhood_reserve: options.robinhoodOpen
      ? {
          ledger_availability: "available",
          paused: false,
          available_capacity: "120000000000000",
          settled_volume_atomic: "31000000000000",
          accrued_fees_atomic: "775000000000",
        }
      : {
          ledger_availability: "not_configured",
          paused: null,
          available_capacity: null,
          settled_volume_atomic: null,
          accrued_fees_atomic: null,
        },
    goldcoin_indexer_halted: false,
    goldcoin_indexer_seconds_since_tick: 8,
    solana_indexer_seconds_since_tick: 4,
    post_finality_reorg_events: 0,
    as_of: NOW_UNIX(),
  };
}

const SAMPLE_STATES: readonly RequestState[] = [
  "AwaitingDeposit",
  "Confirming",
  "SourceFinalized",
  "SettlementAuthorized",
  "DestinationSubmitted",
  "Settled",
  "Settled",
  "ManualReview",
  "Expired",
  // Appended rather than slotted into lifecycle order on purpose: a
  // fixture's id is `1000 + index`, and the e2e specs address these
  // transfers by id.
  "Refunded",
];

const MANUAL_REVIEW_REASON =
  "Deposit amount did not match the reserved quote; routed for manual review.";

/**
 * The refund lifecycle exactly as production emits it, including the
 * backend's own `reason` strings (`glc_refund_started`,
 * `glc_refund_broadcast`). The confirming transition carries no reason
 * because none has been observed on the wire — inventing one here would let
 * a fabricated string leak into a test as if it were the contract.
 */
const REFUND_CHAIN: readonly {
  readonly from: RequestState;
  readonly to: RequestState;
  readonly reason: string | null;
}[] = [
  { from: "AwaitingDeposit", to: "ManualReview", reason: MANUAL_REVIEW_REASON },
  { from: "ManualReview", to: "RefundPending", reason: "glc_refund_started" },
  { from: "RefundPending", to: "RefundBroadcast", reason: "glc_refund_broadcast" },
  { from: "RefundBroadcast", to: "Refunded", reason: null },
];

export function transfersFixture(): TransferViewDto[] {
  const base = NOW_UNIX();
  return SAMPLE_STATES.map((state, index) => {
    const direction = index % 2 === 0 ? ("GlcToSol" as const) : ("SolToGlc" as const);
    // BigInt throughout: these are atomic amounts, and the fixture must be
    // exact for the same reason the real payload is.
    const gross = 500_00000000n + BigInt(index) * 37_00000000n;
    const fee = (gross * BigInt(BRIDGE_FEE_BPS)) / 10_000n;
    const terminal = state === "Settled" || state === "Expired";
    return {
      id: 1000 + index,
      direction,
      state,
      gross_amount_atomic: gross.toString(),
      fee_bps: BRIDGE_FEE_BPS,
      fee_amount_atomic: fee.toString(),
      net_amount_atomic: (gross - fee).toString(),
      created_at: base - (SAMPLE_STATES.length - index) * 900,
      source_txid: state === "AwaitingDeposit" ? null : "a".repeat(64),
      source_confirmations: state === "AwaitingDeposit" ? 0 : 12,
      required_source_confirmations: direction === "GlcToSol" ? 12 : null,
      destination_txid: terminal ? "b".repeat(64) : null,
      failure_reason: state === "ManualReview" ? MANUAL_REVIEW_REASON : null,
      // Only the refund lifecycle carries one, exactly as the backend
      // attaches it (`RefundView` in service/src/api.rs): a settled or
      // in-flight transfer has no refund to describe.
      refund: isRefundState(state) ? refundFixture(direction, gross, state) : null,
    };
  });
}

/**
 * The refund facts the backend's refund row would carry for one of these
 * transfers.
 *
 * A `SolToGlc` deposit cannot diverge from its expected gross — the request is
 * folded FROM the on-chain obligation, so the observed amount is what created
 * it. A `GlcToSol` deposit can arrive short, which is precisely what put
 * production request #2477 into `ManualReview`, so that direction is modelled
 * with a 50 GLC shortfall and mock mode renders the requested-vs-deposited
 * distinction rather than only the case where the two agree.
 */
function refundFixture(
  direction: "GlcToSol" | "SolToGlc",
  gross: bigint,
  state: RequestState,
): RefundViewDto {
  // BigInt throughout, for the same reason the surrounding fixture uses it:
  // these are atomic amounts and must be exact.
  const principal = direction === "GlcToSol" ? gross - 50_00000000n : gross;
  const broadcast = state !== "RefundPending";
  const confirmed = state === "Refunded";
  return {
    state: confirmed ? "Refunded" : broadcast ? "Broadcast" : "Built",
    observed_amount_atomic: principal.toString(),
    // The depositor receives the full observed deposit; the vault absorbs the
    // miner fee.
    refund_amount_atomic: principal.toString(),
    // The bridge fee accrues at settlement only, and a refunded request never
    // settles.
    fee_charged_atomic: "0",
    refund_txid: broadcast ? "c".repeat(64) : null,
    broadcast_at: broadcast ? NOW_UNIX() - 600 : null,
    refunded_at: confirmed ? NOW_UNIX() - 300 : null,
  };
}

export function explorerEventsFixture(): ExplorerEventDto[] {
  const base = NOW_UNIX();
  const transfers = transfersFixture();
  const events: ExplorerEventDto[] = [];
  let id = 1;
  for (const transfer of transfers) {
    events.push({
      id: id++,
      request_id: transfer.id,
      direction: transfer.direction,
      from_state: null,
      to_state: "AwaitingDeposit",
      at: transfer.created_at,
      reason: null,
    });
    if (transfer.state === "Refunded") {
      // A refunded request never reaches its terminal state in one hop — it
      // walks the whole ManualReview -> RefundPending -> RefundBroadcast ->
      // Refunded chain, so mock mode renders the same multi-row lifecycle
      // the production explorer does.
      REFUND_CHAIN.forEach((step, index) => {
        events.push({
          id: id++,
          request_id: transfer.id,
          direction: transfer.direction,
          from_state: step.from,
          to_state: step.to,
          at: transfer.created_at + 300 * (index + 1),
          reason: step.reason,
        });
      });
    } else if (transfer.state !== "AwaitingDeposit") {
      events.push({
        id: id++,
        request_id: transfer.id,
        direction: transfer.direction,
        from_state: "AwaitingDeposit",
        to_state: transfer.state,
        at: transfer.created_at + 300,
        reason: transfer.failure_reason,
      });
    }
  }
  return events
    .sort((a, b) => b.at - a.at)
    .map((event, index) => ({ ...event, id: base + index }));
}

/**
 * Robinhood transfers, kept SEPARATE from `transfersFixture` on purpose.
 *
 * Ids there are positional (`1000 + index`) and the e2e specs address
 * individual transfers by id, so slotting rows into that list would
 * renumber every transfer after the insertion point. These start at 2000
 * and are appended by the mock client only under the `robinhood-open`
 * scenario, which is also the only scenario where `GET /chains` reports
 * the routes open — mock data that could not exist in the state it is
 * served alongside would be a worse fixture than none.
 *
 * The set is chosen to exercise what is genuinely different about a
 * Robinhood route rather than to pad a list:
 *
 * - a `GlcToRhn` that settled, so the DESTINATION transaction is an EVM
 *   hash and the SOURCE is a Goldcoin txid — the case a per-direction
 *   explorer link would have got backwards;
 * - an `RhnToGlc` in flight, whose source is an EVM hash and whose
 *   `required_source_confirmations` is null, because a contract-sourced
 *   deposit folds straight to `SourceFinalized` with no confirmation ramp;
 * - an `RhnToGlc` being refunded with `refund: null`, which is the
 *   backend's deliberate answer for that route (the refund happens on
 *   Robinhood, from a different table in a different unit) and the case
 *   the transfer page must explain rather than fill in;
 * - a `GlcToRhn` still awaiting its deposit.
 */
const ROBINHOOD_TX_HASH = `0x${"e".repeat(64)}`;
const ROBINHOOD_SOURCE_TX_HASH = `0x${"d".repeat(64)}`;

export function robinhoodTransfersFixture(): TransferViewDto[] {
  const base = NOW_UNIX();
  const amounts = (gross: bigint) => {
    const fee = (gross * BigInt(BRIDGE_FEE_BPS)) / 10_000n;
    return {
      gross_amount_atomic: gross.toString(),
      fee_bps: BRIDGE_FEE_BPS,
      fee_amount_atomic: fee.toString(),
      net_amount_atomic: (gross - fee).toString(),
    };
  };

  return [
    {
      id: 2000,
      direction: "GlcToRhn",
      state: "Settled",
      ...amounts(1_200_00000000n),
      created_at: base - 5_400,
      source_txid: "f".repeat(64),
      source_confirmations: 12,
      required_source_confirmations: 12,
      destination_txid: ROBINHOOD_TX_HASH,
      failure_reason: null,
      refund: null,
    },
    {
      id: 2001,
      direction: "RhnToGlc",
      state: "SourceFinalized",
      ...amounts(850_00000000n),
      created_at: base - 3_600,
      source_txid: ROBINHOOD_SOURCE_TX_HASH,
      source_confirmations: 24,
      // Contract-sourced: no confirmation ramp to progress through.
      required_source_confirmations: null,
      destination_txid: null,
      failure_reason: null,
      refund: null,
    },
    {
      id: 2002,
      direction: "RhnToGlc",
      state: "RefundPending",
      ...amounts(410_00000000n),
      created_at: base - 2_700,
      source_txid: ROBINHOOD_SOURCE_TX_HASH,
      source_confirmations: 24,
      required_source_confirmations: null,
      destination_txid: null,
      failure_reason: MANUAL_REVIEW_REASON,
      // Absent BY DESIGN for this route — see this block's doc.
      refund: null,
    },
    {
      id: 2003,
      direction: "GlcToRhn",
      state: "AwaitingDeposit",
      ...amounts(300_00000000n),
      created_at: base - 900,
      source_txid: null,
      source_confirmations: 0,
      required_source_confirmations: 12,
      destination_txid: null,
      failure_reason: null,
      refund: null,
    },
  ];
}

/** Solana and Robinhood transfers in one list, newest first. */
export function mixedTransfersFixture(): TransferViewDto[] {
  return [...transfersFixture(), ...robinhoodTransfersFixture()].sort(
    (a, b) => b.created_at - a.created_at,
  );
}

/** The explorer events those Robinhood transfers would have produced. */
export function robinhoodExplorerEventsFixture(): ExplorerEventDto[] {
  const events: ExplorerEventDto[] = [];
  let id = 900_000;
  for (const transfer of robinhoodTransfersFixture()) {
    events.push({
      id: id++,
      request_id: transfer.id,
      direction: transfer.direction,
      from_state: null,
      to_state: "AwaitingDeposit",
      at: transfer.created_at,
      reason: null,
    });
    if (transfer.state === "AwaitingDeposit") continue;
    events.push({
      id: id++,
      request_id: transfer.id,
      direction: transfer.direction,
      from_state: "AwaitingDeposit",
      to_state: transfer.state,
      at: transfer.created_at + 300,
      reason: transfer.failure_reason,
    });
  }
  return events;
}

/** Solana and Robinhood events interleaved, newest first. */
export function mixedExplorerEventsFixture(): ExplorerEventDto[] {
  return [...explorerEventsFixture(), ...robinhoodExplorerEventsFixture()].sort(
    (a, b) => b.at - a.at,
  );
}

export function reserveHistoryFixture(): ReserveHistoryEntryDto[] {
  const base = NOW_UNIX();
  return Array.from({ length: 12 }, (_, index) => {
    const expected = 4_000_000_00000000n + BigInt(index) * 5_000_00000000n;
    const observed = expected - (index === 5 ? 1_200_00000000n : 0n);
    return {
      id: index + 1,
      direction:
        index % 2 === 0 ? ("SolanaReserve" as const) : ("GoldcoinReserve" as const),
      detected_at: base - (12 - index) * 3600,
      expected_atomic: expected.toString(),
      observed_atomic: observed.toString(),
      delta_atomic: (observed - expected).toString(),
      classification: observed === expected ? "balanced" : "under-observed",
      auto_paused: false,
    };
  });
}

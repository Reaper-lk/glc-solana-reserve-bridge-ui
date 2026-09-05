import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "../schemas/status";
import type { BridgeStatsDto } from "../schemas/stats";
import type { ExplorerEventDto } from "../schemas/explorer";
import type { ReserveHistoryEntryDto } from "../schemas/reserves";
import type { TransferViewDto, RequestState } from "../schemas/transfer";

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

export function statsFixture(): BridgeStatsDto {
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
    };
  });
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

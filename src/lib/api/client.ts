import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "./schemas/status";
import type { BridgeStatsDto } from "./schemas/stats";
import type { ExplorerEventListDto } from "./schemas/explorer";
import type { ReserveHistoryListDto, ReserveDirectionParam } from "./schemas/reserves";
import type { QuoteOutputDto } from "./schemas/quote";
import type { RecipientEligibilityDto } from "./schemas/eligibility";
import type {
  CreateTransferOutputDto,
  CreateTransferRequest,
  RequestState,
  TransferListDto,
  TransferViewDto,
} from "./schemas/transfer";
import type { Direction } from "./schemas/common";

/**
 * The API boundary.
 *
 * Application code depends on this interface, never on an implementation.
 * The concrete client is chosen once, at the composition root, from public
 * config — this is what lets the UI be built and tested against typed
 * fixtures without a hardcoded backend response reaching a component.
 *
 * This mirrors the real, ground-truth surface of
 * `service/src/api.rs` in glc-solana-reserve-bridge — there is no more and
 * no less here than the backend actually implements. In particular there is
 * deliberately no "create SolToGlc transfer" method: that direction has no
 * backend endpoint, the client submits the `deposit_to_reserve` instruction
 * directly (see `src/lib/solana/deposit.ts`), then discovers the resulting
 * transfer via `listTransfers({ address })`.
 */

export interface ListReserveHistoryParams {
  readonly direction?: ReserveDirectionParam;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListExplorerEventsParams {
  readonly direction?: Direction;
  readonly state?: RequestState;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListTransfersParams {
  readonly address?: string;
  readonly state?: RequestState;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface BridgeApiClient {
  getStatus(signal?: AbortSignal): Promise<BridgeStatusDto>;
  getLimits(signal?: AbortSignal): Promise<TransferLimitsDto>;
  getReserve(signal?: AbortSignal): Promise<ReserveAvailabilityDto>;
  getHealth(signal?: AbortSignal): Promise<PublicHealthDto>;
  getStats(signal?: AbortSignal): Promise<BridgeStatsDto>;

  getQuote(
    request: { direction: Direction; gross_amount: number },
    signal?: AbortSignal,
  ): Promise<QuoteOutputDto>;

  /**
   * SolToGlc only — whether this Goldcoin destination address is currently
   * eligible for a new bridge payout, or still inside the backend's rolling
   * 24-hour per-recipient window (`GET /recipients/sol-to-glc/eligibility`).
   * Advisory: the backend re-checks the same ledger rule authoritatively at
   * admission time; the UI calls this to warn BEFORE the wallet is invoked,
   * and again immediately before submission so a stale form-time answer
   * never reaches the wallet.
   */
  getSolToGlcRecipientEligibility(
    address: string,
    signal?: AbortSignal,
  ): Promise<RecipientEligibilityDto>;

  getTransfer(id: number, signal?: AbortSignal): Promise<TransferViewDto>;
  /** GlcToSol only — the backend has no create endpoint for SolToGlc. */
  createTransfer(
    request: CreateTransferRequest,
    signal?: AbortSignal,
  ): Promise<CreateTransferOutputDto>;
  listTransfers(
    params: ListTransfersParams,
    signal?: AbortSignal,
  ): Promise<TransferListDto>;

  listExplorerEvents(
    params: ListExplorerEventsParams,
    signal?: AbortSignal,
  ): Promise<ExplorerEventListDto>;

  listReserveHistory(
    params: ListReserveHistoryParams,
    signal?: AbortSignal,
  ): Promise<ReserveHistoryListDto>;
}

import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "./schemas/status";
import type { BridgeStatsDto } from "./schemas/stats";
import type { RobinhoodLimitsDto, RobinhoodReserveDto } from "./schemas/robinhood";
import type { ChainsViewDto } from "./schemas/chains";
import type { ExplorerEventListDto } from "./schemas/explorer";
import type { ReserveHistoryListDto, ReserveDirectionParam } from "./schemas/reserves";
import type { QuoteOutputDto } from "./schemas/quote";
import type { RecipientEligibilityDto } from "./schemas/eligibility";
import type { RouteEligibility } from "@/lib/bridge/eligibility";
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
 * deliberately no "create SolToGlc transfer" method and no "create
 * RhnToGlc transfer" method: neither contract-sourced route has a backend
 * endpoint. The client submits the chain transaction itself (see
 * `src/lib/solana/deposit.ts` and `src/lib/evm/deposit.ts`), then discovers
 * the resulting transfer via `listTransfers({ address })`.
 *
 * # A known gap, recorded rather than papered over
 *
 * `listTransfers({ address })` accepts a base58 Solana pubkey ONLY. The
 * backend parses `?address=` as a `Pubkey` and its underlying query
 * matches just `GlcToSol.recipient` / `SolToGlc.requester`
 * (`Ledger::transfers_page`), so a 20-byte EVM address returns 400 and
 * Robinhood rows are never returned even if the bytes were accepted.
 * Wallet-scoped activity for Robinhood therefore does not exist yet, on
 * either side. This UI does not fake it: the backend must add EVM address
 * support to `GET /transfers` before that view can work.
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
  /**
   * The chain/route registry — the ONLY authoritative answer to "can a
   * user start a transfer this way right now" (`GET /chains`).
   *
   * Every route-availability decision in this app reads from here. It is
   * never re-derived from public config, from which chains this build
   * knows about, or from whether a contract address happens to be set:
   * that is what makes opening a route a backend-only change.
   */
  getChains(signal?: AbortSignal): Promise<ChainsViewDto>;
  getLimits(signal?: AbortSignal): Promise<TransferLimitsDto>;
  getReserve(signal?: AbortSignal): Promise<ReserveAvailabilityDto>;
  getHealth(signal?: AbortSignal): Promise<PublicHealthDto>;
  getStats(signal?: AbortSignal): Promise<BridgeStatsDto>;
  /**
   * The Robinhood reserve, its custody contract's rolling windows, and its
   * indexer's liveness (`GET /robinhood/reserve`).
   *
   * A SEPARATE endpoint from `getReserve`, mirroring the backend, because
   * the Robinhood reserve is a third independent pool: it is never summed
   * with, differenced against or defaulted from the Goldcoin and Solana
   * figures, and `GET /reserve` deliberately keeps the exact shape every
   * existing client already reads.
   *
   * Call it only when a Robinhood route is actually open. A deployment
   * that predates these endpoints answers 404, and there is nothing on a
   * closed route worth a request per poll tick to find that out.
   */
  getRobinhoodReserve(signal?: AbortSignal): Promise<RobinhoodReserveDto>;

  /**
   * The per-transfer and rolling ceilings the Robinhood custody contract
   * enforces (`GET /robinhood/limits`).
   *
   * A SEPARATE endpoint from `getLimits`, mirroring the backend: that one
   * reports the Solana program's `BridgeConfig`, which governs Solana
   * releases and nothing else. Neither answer may stand in for the other,
   * and this is the only source in the app for a Robinhood route's
   * per-transaction maximum.
   *
   * Call it only when a Robinhood route is actually open, for the same
   * reason as `getRobinhoodReserve`: a deployment that predates the
   * endpoint answers 404.
   */
  getRobinhoodLimits(signal?: AbortSignal): Promise<RobinhoodLimitsDto>;

  getQuote(
    request: { direction: Direction; gross_amount: string },
    signal?: AbortSignal,
  ): Promise<QuoteOutputDto>;

  /**
   * SolToGlc only — whether this Goldcoin destination address AND (when
   * given) this Solana source wallet are currently eligible for a new
   * bridge payout, or either is still inside the backend's rolling 24-hour
   * window (`GET /recipients/sol-to-glc/eligibility`). `wallet` is the
   * connected wallet's base58 pubkey, or `null` before a wallet is
   * connected — omitting it simply means the source-wallet leg is not
   * checked yet, the recipient leg still is.
   *
   * Call it through `fetchRouteEligibility` (`./eligibility-request`)
   * rather than directly: that is the one place which endpoint answers
   * for which route is decided, and it normalises both responses into the
   * single by-SIDE shape `@/lib/bridge/eligibility` gates submission on.
   *
   * The backend re-checks both rules authoritatively at admission time
   * and remains the enforcement. The UI's use of this is nonetheless NOT
   * advisory: an answer that does not positively clear both sides
   * disables submission, because a deposit the bridge would hold back
   * cannot be reversed once it is sent.
   */
  getSolToGlcRecipientEligibility(
    address: string,
    wallet: string | null,
    signal?: AbortSignal,
  ): Promise<RecipientEligibilityDto>;

  /**
   * The `RhnToGlc` twin of `getSolToGlcRecipientEligibility`
   * (`GET /recipients/rhn-to-glc/eligibility`, backend PR #74): the same
   * response shape, the same two rolling-24h limits, the same optional
   * `wallet` leg — spelled as a `0x`-prefixed EVM address here rather
   * than a base58 Solana pubkey.
   *
   * The recipient leg is the SAME window the Solana endpoint reads: one
   * payout per Goldcoin address per 24 hours across every inbound route.
   * The wallet leg is the Robinhood-scoped one, keyed by the custody
   * contract's own recorded depositor, and is never charged against a
   * Solana wallet's window or vice versa.
   *
   * A Robinhood deposit reaches the custody contract with no
   * `POST /transfers` in front of it, so this call is the last refusal
   * available before the funds are committed — a failed read disables the
   * deposit rather than being skipped. Every route now treats an
   * unreadable verdict the same way; this is the route where the cost of
   * not doing so was a user's GLC parked in `ManualReview`. The backend
   * still re-checks authoritatively at fold time and remains the
   * enforcement.
   */
  getRhnToGlcRecipientEligibility(
    address: string,
    wallet: string | null,
    signal?: AbortSignal,
  ): Promise<RecipientEligibilityDto>;

  /**
   * The rolling-24h wallet eligibility verdict for ANY of the six routes,
   * normalised to one shape.
   *
   * # Why the CLIENT decides which endpoint answers
   *
   * The backend publishes two per-route endpoints today (both
   * `*-to-glc`) and a route-agnostic `GET /eligibility` is expected for
   * the rest. Which of those can answer for a given route is a property
   * of the DEPLOYMENT being talked to, not of the form asking — so it
   * belongs behind this boundary, where the real client speaks for the
   * real backend and the fixture client speaks for the fixtures.
   *
   * `HttpBridgeClient` uses a per-route endpoint where one exists and
   * otherwise ATTEMPTS the route-agnostic one, raising
   * `EligibilityEndpointUnpublishedError` on a 404 — so a deployment that
   * does not serve it refuses that route, and one that starts serving it
   * works with no frontend change.
   *
   * Rejects rather than returning a "could not check" value: a function
   * that can return both an answer and a non-answer invites a caller to
   * forget which it got. Every rejection becomes a refusal upstream.
   */
  getRouteEligibility(
    route: string,
    source: string | null,
    destination: string,
    signal?: AbortSignal,
  ): Promise<RouteEligibility>;

  getTransfer(id: number, signal?: AbortSignal): Promise<TransferViewDto>;
  /**
   * Goldcoin-SOURCED routes only (`GlcToSol`, `GlcToRhn`). The backend has
   * no create endpoint for the contract-sourced routes: `SolToGlc` submits
   * `deposit_to_reserve` itself (`src/lib/solana/deposit.ts`) and
   * `RhnToGlc` calls the custody contract's `deposit` (`src/lib/evm`),
   * then both discover the resulting transfer through the activity list.
   */
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

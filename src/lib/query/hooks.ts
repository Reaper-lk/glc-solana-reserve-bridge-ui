"use client";

import { useQuery, useMutation, type UseQueryResult } from "@tanstack/react-query";
import { bridgeApi } from "@/lib/api";
import type {
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "@/lib/api";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type {
  BridgeStatusDto,
  PublicHealthDto,
  ReserveAvailabilityDto,
  TransferLimitsDto,
} from "@/lib/api/schemas/status";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";
import type {
  RobinhoodLimitsDto,
  RobinhoodReserveDto,
} from "@/lib/api/schemas/robinhood";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { ExplorerEventListDto } from "@/lib/api/schemas/explorer";
import type { ReserveHistoryListDto } from "@/lib/api/schemas/reserves";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import type {
  CreateTransferOutputDto,
  CreateTransferRequest,
  TransferListDto,
  TransferViewDto,
} from "@/lib/api/schemas/transfer";
import { isTerminalState } from "@/lib/bridge/state";
import { queryKeys, pollIntervals } from "./keys";

/**
 * One typed hook per bridge endpoint. Application code uses these, never
 * `bridgeApi` directly, so every server-state read goes through react-query
 * caching/retry/staleness policy uniformly.
 */

export function useBridgeStatus(
  initialData?: BridgeStatusDto,
): UseQueryResult<BridgeStatusDto> {
  return useQuery({
    queryKey: queryKeys.status(),
    queryFn: ({ signal }) => bridgeApi.getStatus(signal),
    refetchInterval: pollIntervals.status,
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * The chain/route registry — the authority on route availability.
 *
 * Nothing else in this app may answer "is this route usable". A failed or
 * still-loading read means availability is UNKNOWN, which every consumer
 * treats as closed (`routeAvailability`'s `unknown` case), never as open.
 */
export function useChains(initialData?: ChainsViewDto): UseQueryResult<ChainsViewDto> {
  return useQuery({
    queryKey: queryKeys.chains(),
    queryFn: ({ signal }) => bridgeApi.getChains(signal),
    refetchInterval: pollIntervals.chains,
    ...(initialData ? { initialData } : {}),
  });
}

export function useLimits(
  initialData?: TransferLimitsDto,
): UseQueryResult<TransferLimitsDto> {
  return useQuery({
    queryKey: queryKeys.limits(),
    queryFn: ({ signal }) => bridgeApi.getLimits(signal),
    refetchInterval: pollIntervals.limits,
    ...(initialData ? { initialData } : {}),
  });
}

export function useReserve(
  initialData?: ReserveAvailabilityDto,
): UseQueryResult<ReserveAvailabilityDto> {
  return useQuery({
    queryKey: queryKeys.reserve(),
    queryFn: ({ signal }) => bridgeApi.getReserve(signal),
    refetchInterval: pollIntervals.reserve,
    ...(initialData ? { initialData } : {}),
  });
}

export function useHealth(
  initialData?: PublicHealthDto,
): UseQueryResult<PublicHealthDto> {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: ({ signal }) => bridgeApi.getHealth(signal),
    refetchInterval: pollIntervals.health,
    ...(initialData ? { initialData } : {}),
  });
}

export function useStats(initialData?: BridgeStatsDto): UseQueryResult<BridgeStatsDto> {
  return useQuery({
    queryKey: queryKeys.stats(),
    queryFn: ({ signal }) => bridgeApi.getStats(signal),
    refetchInterval: pollIntervals.stats,
    ...(initialData ? { initialData } : {}),
  });
}

/**
 * The Robinhood reserve, its custody contract's rolling windows and its
 * indexer's liveness (`GET /robinhood/reserve`).
 *
 * # Why this is caller-gated rather than always on
 *
 * `enabled` should be "a Robinhood route is open, per `GET /chains`".
 * Two reasons, both about honesty rather than bandwidth:
 *
 * 1. A deployment that predates these endpoints answers 404. Firing the
 *    request on every page load of every deployment would turn a route
 *    nobody can use into a recurring error in the console and in the
 *    query cache.
 * 2. `/chains` stays the single availability authority. This endpoint
 *    repeats the same `RouteGate` verdict, and gating on `/chains` is
 *    what keeps that a convenience rather than a second opinion the UI
 *    could accidentally prefer.
 *
 * `retry: false` for the same reason: a 404 here is a deployment fact,
 * not a blip, and the caller renders "not published" rather than an
 * error either way.
 */
export function useRobinhoodReserve(
  enabled: boolean,
): UseQueryResult<RobinhoodReserveDto> {
  return useQuery({
    queryKey: queryKeys.robinhoodReserve(),
    queryFn: ({ signal }) => bridgeApi.getRobinhoodReserve(signal),
    enabled,
    refetchInterval: pollIntervals.robinhoodReserve,
    retry: false,
  });
}

/**
 * The Robinhood custody contract's own per-transfer and rolling ceilings
 * (`GET /robinhood/limits`).
 *
 * # Why this is a second limits query rather than more fields on `useLimits`
 *
 * `useLimits` reads `GET /limits`, which is the SOLANA program's
 * `BridgeConfig`. Those bounds govern Solana releases in that mint's own
 * units. The backend refuses to copy them onto a Robinhood route and so
 * does the UI: a Robinhood route's maximum comes from here or it is not
 * shown at all. The alternative — one merged "limits" object — is exactly
 * how a Solana ceiling ends up displayed beside a Robinhood amount.
 *
 * Caller-gated and `retry: false` for the same two reasons
 * {@link useRobinhoodReserve} documents: a deployment that predates the
 * endpoint answers 404, and `/chains` stays the one availability
 * authority.
 */
export function useRobinhoodLimits(enabled: boolean): UseQueryResult<RobinhoodLimitsDto> {
  return useQuery({
    queryKey: queryKeys.robinhoodLimits(),
    queryFn: ({ signal }) => bridgeApi.getRobinhoodLimits(signal),
    enabled,
    refetchInterval: pollIntervals.robinhoodLimits,
    retry: false,
  });
}

/**
 * The authoritative gross/fee/net quote. `grossAmount` of 0 disables the
 * query — the form never shows a quote for an amount that has not been
 * entered.
 */
export function useQuote(
  direction: SettlementRoute,
  /** Exact canonical atomic amount as a decimal string; "0" means none. */
  grossAmount: string,
  /**
   * Additional caller-side gate. The form uses it to withhold a quote for
   * a pair that resolves to no route, or to a route with no settlement
   * machinery — asking the backend to price `SolToRhn` would only earn a
   * refusal it already knows about.
   */
  enabled = true,
): UseQueryResult<QuoteOutputDto> {
  return useQuery({
    queryKey: queryKeys.quote(direction, grossAmount),
    queryFn: ({ signal }) =>
      bridgeApi.getQuote({ direction, gross_amount: grossAmount }, signal),
    enabled: enabled && BigInt(grossAmount) > 0n,
    staleTime: 5_000,
    retry: false,
    /*
     * Opted out of the app-wide `placeholderData: previous => previous`
     * (src/lib/query/provider.tsx).
     *
     * That default keeps the last value on screen through a refetch, which
     * is right for a dashboard figure and wrong for this one. The amount is
     * part of this query's KEY, so "previous" here is the quote for an
     * amount the user has already edited away: with it, typing a new amount
     * left the old fee and "you receive" rendered beside the new figure,
     * and — because a placeholder resolves as `success`, not `pending` —
     * `quotePending` stayed false, so the submit gate did not hold while
     * the real quote was still in flight. A quote is a statement about one
     * exact amount; it does not survive that amount changing.
     *
     * The visible cost is a brief "…" between amounts, which the fee and
     * receive rows already render. That is the honest state.
     */
    placeholderData: () => undefined,
  });
}

/**
 * The SolToGlc dual rate-limit check for the Goldcoin address AND (once
 * connected) the Solana source wallet in the form
 * (`GET /recipients/sol-to-glc/eligibility`). Enabled only once the
 * address has passed local validation — never fired per keystroke on
 * half-typed input; `wallet` is `null` until a wallet is connected, in
 * which case only the recipient leg is checked (the source-wallet leg
 * joins automatically once connected). This is the FORM-level check;
 * `BridgeCard.submit` additionally re-fetches through `bridgeApi` directly
 * immediately before invoking the wallet, so a stale cached "eligible"
 * here can never be what authorizes opening Phantom.
 */
export function useSolToGlcRecipientEligibility(
  address: string,
  wallet: string | null,
  enabled: boolean,
): UseQueryResult<RecipientEligibilityDto> {
  return useQuery({
    queryKey: queryKeys.recipientEligibility("SolToGlc", address, wallet),
    queryFn: ({ signal }) =>
      bridgeApi.getSolToGlcRecipientEligibility(address, wallet, signal),
    enabled: enabled && address.length > 0,
    refetchInterval: pollIntervals.recipientEligibility,
    staleTime: 15_000,
    retry: false,
  });
}

/**
 * The `RhnToGlc` twin (`GET /recipients/rhn-to-glc/eligibility`) — the
 * same two rolling-24h limits, with the source-wallet leg keyed by the
 * connected EVM address instead of a Solana pubkey.
 *
 * # Why this one is not merely a warning
 *
 * Its Solana sibling is advisory: a failed read there is skipped, because
 * `SolToGlc` funds land in a program the bridge controls and the backend
 * re-checks at admission anyway. `RhnToGlc` has no such floor — the
 * deposit goes straight to the custody contract and a blocked one is
 * folded into `ManualReview` with the funds already committed. So the
 * FORM treats pending, failed and absent alike as "not eligible yet", and
 * `BridgeForm.submit` re-fetches through `bridgeApi` directly immediately
 * before the wallet is invoked. Nothing cached here can be the thing that
 * authorizes a deposit.
 *
 * `retry: false` deliberately: a fail-closed check must reach its refusal
 * promptly rather than sitting in "checking…" through a retry ladder,
 * and the poll interval below re-attempts it on its own.
 */
export function useRhnToGlcRecipientEligibility(
  address: string,
  wallet: string | null,
  enabled: boolean,
): UseQueryResult<RecipientEligibilityDto> {
  return useQuery({
    queryKey: queryKeys.recipientEligibility("RhnToGlc", address, wallet),
    queryFn: ({ signal }) =>
      bridgeApi.getRhnToGlcRecipientEligibility(address, wallet, signal),
    enabled: enabled && address.length > 0,
    refetchInterval: pollIntervals.recipientEligibility,
    staleTime: 15_000,
    retry: false,
  });
}

export function useTransfer(
  id: number,
  initialData?: TransferViewDto,
): UseQueryResult<TransferViewDto> {
  return useQuery({
    queryKey: queryKeys.transfer(id),
    queryFn: ({ signal }) => bridgeApi.getTransfer(id, signal),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && isTerminalState(data.state)) return pollIntervals.terminalTransfer;
      return pollIntervals.activeTransfer;
    },
    ...(initialData ? { initialData } : {}),
  });
}

export function useTransfers(
  params: ListTransfersParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<TransferListDto> {
  return useQuery({
    queryKey: queryKeys.transfers(params),
    queryFn: ({ signal }) => bridgeApi.listTransfers(params, signal),
    refetchInterval: pollIntervals.transferList,
    enabled: options.enabled ?? true,
  });
}

export function useExplorerEvents(
  params: ListExplorerEventsParams,
): UseQueryResult<ExplorerEventListDto> {
  return useQuery({
    queryKey: queryKeys.explorerEvents(params),
    queryFn: ({ signal }) => bridgeApi.listExplorerEvents(params, signal),
    refetchInterval: pollIntervals.explorerEvents,
  });
}

export function useReserveHistory(
  params: ListReserveHistoryParams,
): UseQueryResult<ReserveHistoryListDto> {
  return useQuery({
    queryKey: queryKeys.reserveHistory(params),
    queryFn: ({ signal }) => bridgeApi.listReserveHistory(params, signal),
    refetchInterval: pollIntervals.reserveHistory,
  });
}

export function useCreateTransfer() {
  return useMutation<CreateTransferOutputDto, unknown, CreateTransferRequest>({
    mutationFn: (request) => bridgeApi.createTransfer(request),
  });
}

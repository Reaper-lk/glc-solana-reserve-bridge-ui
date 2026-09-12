import type {
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "@/lib/api";

/** Query keys and polling policy, declared together so they cannot drift. */

export const queryKeys = {
  status: () => ["bridge", "status"] as const,
  chains: () => ["bridge", "chains"] as const,
  limits: () => ["bridge", "limits"] as const,
  reserve: () => ["bridge", "reserve"] as const,
  health: () => ["bridge", "health"] as const,
  stats: () => ["bridge", "stats"] as const,
  robinhoodReserve: () => ["bridge", "robinhood", "reserve"] as const,
  robinhoodLimits: () => ["bridge", "robinhood", "limits"] as const,
  quote: (direction: string, grossAmount: string) =>
    ["bridge", "quote", direction, grossAmount] as const,
  /**
   * The unified six-route rolling-24h wallet eligibility verdict.
   *
   * Every input the verdict is about is in the key, which is what makes
   * the refresh triggers the UX requires fall out of React Query rather
   * than out of hand-written effects:
   *
   * - ROUTE — a verdict is per route; two routes never share an entry.
   * - SOURCE wallet — covers both "the user connected a different
   *   wallet" and "the wallet switched accounts", which are the same
   *   event from this query's point of view.
   * - DESTINATION — a verdict is a statement about exactly this pair.
   * - CHAIN — the connected network. Not part of the backend question,
   *   and in the key anyway: switching networks changes which wallet
   *   identity the connected address even belongs to, and a verdict
   *   obtained on another chain must not be reused across that.
   *
   * Changing any of them is a cache MISS, never a stale "eligible"
   * carried across the edit. `refetchOnWindowFocus` (the app-wide
   * default) covers a page regaining focus, and a successful submission
   * invalidates this prefix explicitly.
   */
  routeEligibility: (
    route: string,
    source: string | null,
    destination: string,
    chainId: number | null,
  ) => ["bridge", "route-eligibility", route, source, destination, chainId] as const,
  /** The prefix, for invalidating every route's verdict after a submission. */
  routeEligibilityAll: () => ["bridge", "route-eligibility"] as const,
  transfer: (id: number) => ["bridge", "transfer", id] as const,
  transfers: (params: ListTransfersParams) => ["bridge", "transfers", params] as const,
  explorerEvents: (params: ListExplorerEventsParams) =>
    ["bridge", "explorer", "events", params] as const,
  reserveHistory: (params: ListReserveHistoryParams) =>
    ["bridge", "reserves", "history", params] as const,
} as const;

/**
 * Refetch intervals in milliseconds.
 *
 * A transfer in flight is polled often enough to feel live; a transfer in a
 * terminal state (`Settled`, `Expired`, `Cancelled`, `Reorged`,
 * `InsufficientReserveAtSettlement`, `DestinationSubmissionFailed`,
 * `Failed`) is not polled at all. Live values are always refreshed in place
 * with an "updated Ns ago" stamp — they never blank out to a skeleton.
 */
export const pollIntervals = {
  /** The global trust strip. Wrong status here is worse than stale status. */
  status: 30_000,
  /**
   * The route registry. Polled on the same cadence as status rather than
   * the slow `limits` cadence: this is what decides whether a route can
   * be used at all, and a route closing (or opening) mid-session must not
   * sit stale behind a five-minute window while the form still offers it.
   */
  chains: 30_000,
  /** Fee schedule and caps change rarely. */
  limits: 300_000,
  /** Reserve capacity. Polled on every page — the pause/liquidity banner is site-wide. */
  reserve: 30_000,
  health: 60_000,
  stats: 60_000,
  /**
   * The Robinhood reserve, its contract windows and its indexer. Same
   * cadence as `reserve`: it backs the same kind of capacity/pause
   * statement, and a stale figure there is wrong in the same way.
   */
  robinhoodReserve: 30_000,
  /**
   * The Robinhood custody contract's per-transfer and rolling ceilings.
   * Same slow cadence as `limits`, and for the same reason: changing one
   * is a `setLimits` transaction under a 2-of-3 signer quorum, not
   * something that moves between two form keystrokes.
   */
  robinhoodLimits: 300_000,
  /**
   * The unified six-route eligibility verdict, on the same cadence and
   * for the same two reasons: a wallet that became blocked elsewhere
   * shows up without a retype, and — the reason this is a poll and not a
   * one-shot — a BLOCKED wallet re-enables itself the moment the backend
   * says its rolling window has expired. There is no client-side timer
   * counting down to that; the backend is asked again and believed.
   */
  routeEligibility: 30_000,
  /** A transfer the user is actively watching. */
  activeTransfer: 8_000,
  /** A transfer that has reached a terminal state. */
  terminalTransfer: false,
  transferList: 30_000,
  /** The public event feed. Live enough to show the bridge is alive. */
  explorerEvents: 30_000,
  reserveHistory: 120_000,
} as const;

import type {
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "@/lib/api";

/** Query keys and polling policy, declared together so they cannot drift. */

export const queryKeys = {
  status: () => ["bridge", "status"] as const,
  limits: () => ["bridge", "limits"] as const,
  reserve: () => ["bridge", "reserve"] as const,
  health: () => ["bridge", "health"] as const,
  stats: () => ["bridge", "stats"] as const,
  quote: (direction: string, grossAmount: number) =>
    ["bridge", "quote", direction, grossAmount] as const,
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
  /** Fee schedule and caps change rarely. */
  limits: 300_000,
  /** Reserve capacity. Polled on every page — the pause/liquidity banner is site-wide. */
  reserve: 30_000,
  health: 60_000,
  stats: 60_000,
  /** A transfer the user is actively watching. */
  activeTransfer: 8_000,
  /** A transfer that has reached a terminal state. */
  terminalTransfer: false,
  transferList: 30_000,
  /** The public event feed. Live enough to show the bridge is alive. */
  explorerEvents: 30_000,
  reserveHistory: 120_000,
} as const;

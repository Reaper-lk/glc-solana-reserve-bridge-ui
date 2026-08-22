import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  Pause,
  Settings,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { RequestState } from "@/lib/api/schemas/transfer";

/**
 * The status vocabulary.
 *
 * One system, used identically in the global bar, cards, table rows, the
 * transfer detail page and the explorer. Two rules are enforced
 * structurally here rather than by review:
 *
 *   1. Every status carries colour AND icon AND text. Components take a
 *      status token, never a colour, so a bare coloured dot with no
 *      accessible label cannot be constructed.
 *   2. Brand gold is absent from every tone below. Gold marks brand, the
 *      active step, and focus — never state.
 */

export type StatusTone = "success" | "warn" | "danger" | "info" | "neutral";

export interface StatusDescriptor {
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: LucideIcon;
}

/* -------------------------------------------------------------------------- */
/* System                                                                      */
/* -------------------------------------------------------------------------- */

export type SystemStatus = "operational" | "degraded" | "paused" | "maintenance";

export const systemStatus: Record<SystemStatus, StatusDescriptor> = {
  operational: { label: "Operational", tone: "success", icon: CircleCheck },
  degraded: { label: "Degraded", tone: "warn", icon: CircleAlert },
  paused: { label: "Paused", tone: "danger", icon: Pause },
  maintenance: { label: "Maintenance", tone: "info", icon: Settings },
};

/* -------------------------------------------------------------------------- */
/* Transfer (RequestState)                                                     */
/* -------------------------------------------------------------------------- */

/** Every value the real backend `RequestState` enum can emit. */
export const requestStateStatus: Record<RequestState, StatusDescriptor> = {
  LiquidityReserved: { label: "Reserving capacity", tone: "neutral", icon: Circle },
  AwaitingDeposit: {
    label: "Awaiting your deposit",
    tone: "neutral",
    icon: CircleDashed,
  },
  DepositObserved: { label: "Deposit observed", tone: "info", icon: CircleDot },
  Confirming: { label: "Confirming", tone: "info", icon: CircleDot },
  SourceFinalized: { label: "Source confirmed", tone: "info", icon: CircleDot },
  SettlementAuthorized: { label: "Settlement authorized", tone: "info", icon: CircleDot },
  DestinationSubmitted: { label: "Sending your funds", tone: "info", icon: CircleDot },
  DestinationConfirmed: { label: "Destination confirmed", tone: "info", icon: CircleDot },
  Settled: { label: "Settled", tone: "success", icon: CircleCheck },
  Expired: { label: "Expired", tone: "neutral", icon: CircleSlash },
  Cancelled: { label: "Cancelled", tone: "neutral", icon: CircleSlash },
  Reorged: { label: "Reversed by a reorg", tone: "danger", icon: CircleX },
  InsufficientReserveAtSettlement: {
    label: "Reserve ran out before settlement",
    tone: "danger",
    icon: CircleX,
  },
  DestinationSubmissionFailed: {
    label: "Destination transaction failed",
    tone: "danger",
    icon: CircleX,
  },
  ManualReview: { label: "Under manual review", tone: "warn", icon: TriangleAlert },
  Failed: { label: "Failed", tone: "danger", icon: CircleX },
};

/* -------------------------------------------------------------------------- */
/* Reserve / direction availability                                            */
/* -------------------------------------------------------------------------- */

export type DirectionAvailability =
  "available" | "paused" | "insufficient-liquidity" | "quota-exhausted" | "quota-paused";

export const directionAvailabilityStatus: Record<
  DirectionAvailability,
  StatusDescriptor
> = {
  available: { label: "Available", tone: "success", icon: CircleCheck },
  paused: { label: "Paused", tone: "danger", icon: Pause },
  "insufficient-liquidity": {
    label: "Insufficient liquidity",
    tone: "warn",
    icon: TriangleAlert,
  },
  // Rolling-24h-volume quota states (backend 2026-08-22 workflow). Labels
  // deliberately promise no reset time and no automatic reopening.
  "quota-exhausted": {
    label: "24h capacity reached",
    tone: "warn",
    icon: TriangleAlert,
  },
  "quota-paused": {
    label: "Paused for refill",
    tone: "danger",
    icon: Pause,
  },
};

/* -------------------------------------------------------------------------- */
/* Wallet connection                                                           */
/* -------------------------------------------------------------------------- */

export type WalletConnectionStatus = "connected" | "connecting" | "disconnected";

export const walletStatus: Record<WalletConnectionStatus, StatusDescriptor> = {
  connected: { label: "Connected", tone: "success", icon: CircleCheck },
  connecting: { label: "Connecting", tone: "info", icon: CircleDot },
  disconnected: { label: "Not connected", tone: "neutral", icon: CircleDashed },
};

/* -------------------------------------------------------------------------- */
/* Step state (client-derived stepper rendering)                              */
/* -------------------------------------------------------------------------- */

export type StepState = "pending" | "active" | "done" | "failed";

export const stepState: Record<StepState, StatusDescriptor> = {
  pending: { label: "Waiting", tone: "neutral", icon: Circle },
  active: { label: "In progress", tone: "info", icon: CircleDot },
  done: { label: "Done", tone: "success", icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", icon: CircleX },
};

/* -------------------------------------------------------------------------- */
/* Tone styling                                                                */
/* -------------------------------------------------------------------------- */

export const toneStyles: Record<
  StatusTone,
  {
    readonly dot: string;
    readonly text: string;
    readonly badge: string;
    readonly alert: string;
    readonly bar: string;
    readonly halo: string;
  }
> = {
  success: {
    dot: "bg-success-500",
    text: "text-success-700",
    badge: "bg-success-50 text-success-700",
    alert: "bg-success-50 border-l-success-500",
    bar: "bg-success-50 border-success-100",
    halo: "bg-success-100",
  },
  warn: {
    dot: "bg-warn-500",
    text: "text-warn-700",
    badge: "bg-warn-50 text-warn-700",
    alert: "bg-warn-50 border-l-warn-500",
    bar: "bg-warn-50 border-warn-100",
    halo: "bg-warn-100",
  },
  danger: {
    dot: "bg-danger-500",
    text: "text-danger-700",
    badge: "bg-danger-50 text-danger-700",
    alert: "bg-danger-50 border-l-danger-500",
    bar: "bg-danger-50 border-danger-100",
    halo: "bg-danger-100",
  },
  info: {
    dot: "bg-info-500",
    text: "text-info-700",
    badge: "bg-info-50 text-info-700",
    alert: "bg-info-50 border-l-info-500",
    bar: "bg-info-50 border-info-100",
    halo: "bg-info-100",
  },
  neutral: {
    dot: "bg-ink-400",
    text: "text-ink-600",
    badge: "bg-ink-100 text-ink-700",
    alert: "bg-ink-50 border-l-ink-300",
    bar: "bg-ink-50 border-ink-200",
    halo: "bg-ink-200",
  },
};

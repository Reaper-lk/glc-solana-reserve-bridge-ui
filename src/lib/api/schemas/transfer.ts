import { z } from "zod";
import {
  directionSchema,
  nonNegativeAtomicAmountSchema,
  paginatedSchema,
  unixSecondsSchema,
} from "./common";

/**
 * `RequestState` — the real, currently-implemented wire enum from
 * `service/src/ledger/types.rs`. Every one of these values can appear on the
 * wire; the UI must render all of them without crashing.
 *
 * States after `SourceFinalized` are defined by the backend but not yet
 * driven by an implemented settlement pipeline (see
 * `docs/MIGRATION_ASSESSMENT.md`) — the UI must not assume every transfer
 * reaches `Settled`, only that it could, and must render whatever state the
 * backend actually reports.
 *
 * The three `Refund*` values are the refund lifecycle production actually
 * emits: a request that cannot settle is routed to `ManualReview` and the
 * operator returns the deposit, which walks
 * `ManualReview -> RefundPending -> RefundBroadcast -> Refunded`
 * (`reason` = `glc_refund_started`, then `glc_refund_broadcast`). A refund
 * is a completed, non-failure outcome — the user's funds came back — so it
 * is deliberately neither a failure state nor a settlement success.
 *
 * This list is what a TRANSFER may be in, and it stays strict: an unknown
 * value on `GET /transfers/:id` is a contract break for that one transfer
 * and must be surfaced, not guessed at. The explorer, which renders every
 * request's history at once, relaxes this per row — see
 * `eventRequestStateSchema` in `./explorer`.
 */
export const requestStateSchema = z.enum([
  "LiquidityReserved",
  "AwaitingDeposit",
  "DepositObserved",
  "Confirming",
  "SourceFinalized",
  "SettlementAuthorized",
  "DestinationSubmitted",
  "DestinationConfirmed",
  "Settled",
  "Expired",
  "Cancelled",
  "Reorged",
  "InsufficientReserveAtSettlement",
  "DestinationSubmissionFailed",
  "ManualReview",
  "RefundPending",
  "RefundBroadcast",
  "Refunded",
  "Failed",
]);

export type RequestState = z.infer<typeof requestStateSchema>;

/** `TransferView` — used by GET /transfers/:id and as list items in GET /transfers. */
export const transferViewSchema = z.object({
  id: z.number().int(),
  direction: directionSchema,
  state: requestStateSchema,
  gross_amount_atomic: nonNegativeAtomicAmountSchema,
  /** Basis points — bounded, stays a number. */
  fee_bps: z.number().int().nonnegative(),
  fee_amount_atomic: nonNegativeAtomicAmountSchema,
  net_amount_atomic: nonNegativeAtomicAmountSchema,
  created_at: unixSecondsSchema,
  source_txid: z.string().nullable(),
  source_confirmations: z.number().int().nonnegative(),
  required_source_confirmations: z.number().int().nonnegative().nullable(),
  destination_txid: z.string().nullable(),
  failure_reason: z.string().nullable(),
});

export type TransferViewDto = z.infer<typeof transferViewSchema>;

export const transferListSchema = paginatedSchema(transferViewSchema);
export type TransferListDto = z.infer<typeof transferListSchema>;

/** Request body for `POST /transfers` — `CreateTransferInput`. GlcToSol only. */
export const createTransferRequestSchema = z.object({
  /**
   * Sent as an exact decimal string. The backend accepts a string or a
   * number, and a string is the only form that can carry an amount above
   * `Number.MAX_SAFE_INTEGER` without corrupting it.
   */
  amount_atomic: z.string().regex(/^\d+$/, "must be a decimal integer string"),
  recipient: z.string().min(1),
});

export type CreateTransferRequest = z.infer<typeof createTransferRequestSchema>;

/**
 * `201` body for `POST /transfers` — `CreateTransferOutput`.
 *
 * `deposit_address` is unique to this one request (`goldcoin::derivation`
 * in glc-solana-reserve-bridge) — the user sends the exact amount they
 * requested to it directly. No OP_RETURN or other binding value is
 * needed or returned.
 */
export const createTransferOutputSchema = z.object({
  request_id: z.number().int(),
  deposit_address: z.string().min(1),
});

export type CreateTransferOutputDto = z.infer<typeof createTransferOutputSchema>;

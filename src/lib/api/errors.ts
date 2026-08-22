import { type ApiErrorBody } from "./schemas/common";

/**
 * The error contract, mapped once into the shape the UI is required to
 * render. Every error in this product states three things, in this order:
 *   1. what happened
 *   2. what it means for the user's funds
 *   3. what to do next
 *
 * The bridge API (`service/src/api.rs`) has no structured error-code field —
 * every non-2xx response is `{ "error": "<free text>" }`, distinguished only
 * by HTTP status. `409` covers two distinct, real conditions (insufficient
 * destination liquidity vs. a paused destination reserve); they are told
 * apart here by matching the backend's fixed message text
 * (`ApiError::InsufficientLiquidity` / `ApiError::Paused` in api.rs), which
 * is a stable, tested string, not a coincidence to rely on lightly.
 */

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "not-found"
  | "rate-limited"
  | "server"
  | "direction-unavailable"
  | "bad-request"
  | "validation";

export interface ErrorPresentation {
  readonly what: string;
  readonly funds: string;
  readonly next: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly presentation: ErrorPresentation;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    presentation: ErrorPresentation;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.retryable = init.retryable;
    this.status = init.status;
    this.presentation = init.presentation;
  }
}

const READ_ONLY_FUNDS_NOTE =
  "No funds moved. This is a problem displaying information, not a problem with your transfer.";

export function networkError(cause: unknown): ApiError {
  return new ApiError({
    kind: "network",
    message: "Network request failed",
    retryable: true,
    cause,
    presentation: {
      what: "We could not reach the bridge.",
      funds: READ_ONLY_FUNDS_NOTE,
      next: "Check your connection and try again. If it persists, see the status page.",
    },
  });
}

export function timeoutError(cause?: unknown): ApiError {
  return new ApiError({
    kind: "timeout",
    message: "Request timed out",
    retryable: true,
    cause,
    presentation: {
      what: "The bridge took too long to respond.",
      funds: READ_ONLY_FUNDS_NOTE,
      next: "Try again. If this keeps happening, check the status page for an incident.",
    },
  });
}

export function notFoundError(what: string): ApiError {
  return new ApiError({
    kind: "not-found",
    message: `${what} not found`,
    retryable: false,
    status: 404,
    presentation: {
      what: `We could not find that ${what}.`,
      funds:
        "If you have already sent funds, they are on-chain and are not affected by this page.",
      next: "Check the identifier and try again, or search by transaction ID.",
    },
  });
}

export function rateLimitedError(): ApiError {
  return new ApiError({
    kind: "rate-limited",
    message: "Rate limited",
    retryable: true,
    status: 429,
    presentation: {
      what: "We are refreshing this too quickly.",
      funds: READ_ONLY_FUNDS_NOTE,
      next: "This will resume on its own in a moment.",
    },
  });
}

export function badRequestError(message: string): ApiError {
  return new ApiError({
    kind: "bad-request",
    message,
    retryable: false,
    status: 400,
    presentation: {
      what: message,
      funds: READ_ONLY_FUNDS_NOTE,
      next: "Adjust the amount or address and try again.",
    },
  });
}

/**
 * The single 409 the backend emits for a direction that cannot accept a
 * new transfer. Since the 2026-08-22 quota workflow, `ApiError::Paused`,
 * `ApiError::InsufficientLiquidity`, and `ApiError::QuotaExhausted` all
 * return the SAME cause-agnostic, approved message
 * (`DIRECTION_UNAVAILABLE_MESSAGE` in api.rs) — the message text can no
 * longer distinguish causes, so this maps all of them to one error and the
 * UI reads the specific cause from `GET /status`'s boolean fields instead.
 * Deliberately no reset-time or automatic-reopening claim: there is none.
 */
export function directionUnavailableError(message?: string): ApiError {
  return new ApiError({
    kind: "direction-unavailable",
    message: message ?? "Bridge capacity reached for this direction.",
    retryable: true,
    status: 409,
    presentation: {
      what: "Bridge capacity reached for this direction.",
      funds:
        "No funds have left your wallet. Nothing has been sent yet. Transfers are temporarily paused while reserves are replenished.",
      next: "Please check the official Telegram for reopening updates.",
    },
  });
}

export function serverError(body: ApiErrorBody | null, status: number): ApiError {
  return new ApiError({
    kind: "server",
    message: body?.error ?? `Bridge API responded ${status}`,
    retryable: status >= 500,
    status,
    presentation: {
      what: "The bridge could not complete that request.",
      funds: READ_ONLY_FUNDS_NOTE,
      next: "Try again shortly, or check the status page for an active incident.",
    },
  });
}

export function validationError(endpoint: string, cause: unknown): ApiError {
  return new ApiError({
    kind: "validation",
    message: `Response from ${endpoint} did not match its schema`,
    retryable: false,
    cause,
    presentation: {
      what: "The bridge returned data this page could not read.",
      funds: READ_ONLY_FUNDS_NOTE,
      next: "This is a fault on our side. Please report it with the diagnostic details.",
    },
  });
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function toPresentation(error: unknown): ErrorPresentation {
  if (isApiError(error)) return error.presentation;
  return {
    what: "Something went wrong loading this page.",
    funds: READ_ONLY_FUNDS_NOTE,
    next: "Try again. If it keeps happening, please get in touch.",
  };
}

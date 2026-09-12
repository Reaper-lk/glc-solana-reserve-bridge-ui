import { type ApiErrorBody } from "./schemas/common";
import {
  eligibilityBlockedDetail,
  eligibilityBlockedTitle,
  ELIGIBILITY_UNAVAILABLE_NEXT,
  ELIGIBILITY_UNAVAILABLE_TITLE,
  type EligibilityVerdict,
} from "@/lib/bridge/eligibility";
import {
  formatRetryAfter,
  formatRetryAt,
  type RobinhoodPredepositVerdict,
} from "@/lib/bridge/robinhood-predeposit";

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
  | "validation"
  | "solana-transaction"
  | "evm-transaction"
  | "eligibility-blocked"
  | "eligibility-unavailable"
  | "robinhood-predeposit-refused";

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

/**
 * The FINAL pre-submit eligibility re-check came back BLOCKED: one or
 * both wallets are inside the backend's rolling 24-hour window for this
 * route. Thrown before any wallet is invoked, on every route.
 *
 * # Why the re-check exists at all
 *
 * A verdict can go stale between a button enabling and a click landing —
 * another deposit lands, a payout settles, the user opens a second tab.
 * The form's live query is what disables the button; this error is what
 * happens when the fresh read taken immediately before signing disagrees
 * with it.
 *
 * Copy comes from `@/lib/bridge/eligibility`, the same module the form's
 * own callout reads, so a refused click and a disabled button can never
 * say different things. The reopen time is the BACKEND's, absolute where
 * it published one and relative where it published only seconds — never
 * a guessed window, and nothing at all when it published neither.
 */
export function eligibilityBlockedError(
  verdict: Extract<EligibilityVerdict, { kind: "blocked" }>,
  nowSeconds: number,
): ApiError {
  const title = eligibilityBlockedTitle(verdict.sides);
  // The absolute instant when the backend gave one — it stays correct
  // however long this error sits on screen, unlike a relative figure
  // measured against a clock that has since moved on.
  const side =
    verdict.sides[0] === "destination"
      ? verdict.answer.destinationSide
      : verdict.answer.sourceSide;
  const when = formatRetryAt(side.retryAt) ?? formatRetryAfter(side.remainingSeconds);
  return new ApiError({
    kind: "eligibility-blocked",
    message: title,
    retryable: false,
    presentation: {
      what: title,
      funds: "No funds have left your wallet — nothing was submitted.",
      next:
        eligibilityBlockedDetail(verdict, nowSeconds) ||
        (when === null ? "" : `You can bridge on this route again ${when}.`),
    },
  });
}

/**
 * The FINAL pre-submit eligibility re-check could not be ESTABLISHED —
 * the request failed, the backend publishes no endpoint for this route
 * yet, or the answer was about different inputs than the form holds.
 *
 * Deliberately distinct from `eligibilityBlockedError`: this says the
 * CHECK did not complete, never that the user is rate limited. Asserting
 * a limit the backend never asserted would be its own wrong answer, and
 * the two have different remedies.
 */
export function eligibilityUnavailableError(): ApiError {
  return new ApiError({
    kind: "eligibility-unavailable",
    message: ELIGIBILITY_UNAVAILABLE_TITLE,
    retryable: false,
    presentation: {
      what: ELIGIBILITY_UNAVAILABLE_TITLE,
      funds: "No funds have left your wallet — nothing was submitted.",
      next: ELIGIBILITY_UNAVAILABLE_NEXT,
    },
  });
}

/**
 * The FINAL pre-deposit AVAILABILITY re-check for a contract-sourced
 * Robinhood route refused, so no EVM transaction was ever built.
 *
 * Availability only — the wallet-eligibility half is
 * `eligibilityBlockedError`/`eligibilityUnavailableError`, which apply to
 * every route. Built from the same `RobinhoodPredepositVerdict` the
 * form's disabled button is built from, so the reason a click is refused
 * is always the reason the button was already giving.
 */
export function robinhoodPredepositError(
  verdict: Exclude<RobinhoodPredepositVerdict, { kind: "allowed" }>,
): ApiError {
  const presentation: ErrorPresentation = {
    // The backend's own cause-agnostic sentence, verbatim. This UI never
    // authors a second explanation of a closed route.
    what: verdict.reason,
    funds: "No funds have left your wallet — no deposit transaction was created.",
    next: "Check the status page for live route availability, or try again later.",
  };
  return new ApiError({
    kind: "robinhood-predeposit-refused",
    message: presentation.what,
    retryable: false,
    presentation,
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

/**
 * A short, safe-to-render hint pulled from a thrown wallet/RPC error's own
 * message — never a full stack trace, never anything from request/response
 * bodies that could carry secrets. `sendTransaction`/`confirmTransaction`
 * failures from `@solana/web3.js`/wallet-adapter always carry their detail
 * in `.message` (e.g. an RPC's rejection reason, or "User rejected the
 * request"), so this is enough to be useful without being a debug console.
 */
function safeDiagnostic(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const message = cause.message.trim();
  return message.length > 0 ? message.slice(0, 200) : undefined;
}

/**
 * `adapter.sendTransaction` failed — the transaction was never broadcast
 * (a rejected RPC request, e.g. a 403 from an endpoint that doesn't accept
 * browser-origin traffic, or the wallet itself refusing to sign/send), so
 * it is safe to say plainly that nothing left the wallet.
 */
export function solanaSendError(cause: unknown): ApiError {
  const diagnostic = safeDiagnostic(cause);
  return new ApiError({
    kind: "solana-transaction",
    message: "Solana transaction could not be submitted",
    retryable: true,
    cause,
    presentation: {
      what: "The Solana transaction could not be submitted.",
      funds: "No funds have left your wallet — the transaction was never sent.",
      next: diagnostic
        ? `Check your wallet and network connection, then try again. Reason: ${diagnostic}`
        : "Check your wallet and network connection, then try again.",
    },
  });
}

/**
 * The transaction was broadcast (it has a `signature`), but confirming it
 * failed or timed out — unlike a send failure, this is genuinely
 * ambiguous: the transaction may have already landed. Never claim funds
 * are safe here; point at the one place that can actually answer that.
 */
export function solanaConfirmationError(cause: unknown, signature: string): ApiError {
  const diagnostic = safeDiagnostic(cause);
  return new ApiError({
    kind: "solana-transaction",
    message: "Solana transaction confirmation failed",
    retryable: false,
    cause,
    presentation: {
      what: "The Solana transaction was submitted, but its confirmation could not be verified.",
      funds: `Check signature ${signature} on a Solana explorer before retrying — it may have already succeeded.`,
      next: diagnostic
        ? `If the explorer shows no successful transaction, try again. Reason: ${diagnostic}`
        : "If the explorer shows no successful transaction, try again.",
    },
  });
}

/**
 * A Robinhood (EVM) deposit was refused BEFORE anything was signed —
 * a preflight read said the route is not live, the amount is outside the
 * contract's own limits, the configured token and contract disagree, or
 * the balance is short.
 *
 * Every one of these is knowable without a signature, which is the whole
 * point of running them: the user is told plainly that nothing has moved,
 * because nothing was ever sent.
 */
export function evmPreflightError(what: string, next: string): ApiError {
  return new ApiError({
    kind: "evm-transaction",
    message: "Robinhood deposit preflight refused",
    retryable: false,
    presentation: {
      what,
      funds: "No funds have left your wallet — nothing was submitted.",
      next,
    },
  });
}

/**
 * The ERC-20 approval or the deposit itself was never broadcast — the
 * wallet rejected it, or the request failed before reaching the network.
 * Safe to state plainly that nothing moved.
 */
export function evmSendError(cause: unknown, step: "approval" | "deposit"): ApiError {
  const diagnostic = safeDiagnostic(cause);
  const label = step === "approval" ? "token approval" : "deposit transaction";
  return new ApiError({
    kind: "evm-transaction",
    message: `Robinhood ${label} could not be submitted`,
    retryable: true,
    cause,
    presentation: {
      what: `The ${label} could not be submitted.`,
      funds: "No funds have left your wallet — the transaction was never sent.",
      next: diagnostic
        ? `Check your wallet and network connection, then try again. Reason: ${diagnostic}`
        : "Check your wallet and network connection, then try again.",
    },
  });
}

/**
 * The transaction WAS broadcast (there is a hash) but its receipt could
 * not be confirmed, or it reverted.
 *
 * Genuinely ambiguous for a timeout, and definitively bad for a revert —
 * neither may claim the funds are safe. Both point the user at the one
 * artefact that can actually answer it: the transaction hash.
 */
export function evmConfirmationError(
  cause: unknown,
  hash: string,
  outcome: "reverted" | "unconfirmed",
): ApiError {
  const diagnostic = safeDiagnostic(cause);
  const reverted = outcome === "reverted";
  return new ApiError({
    kind: "evm-transaction",
    message: reverted
      ? "Robinhood deposit reverted"
      : "Robinhood deposit confirmation failed",
    retryable: false,
    cause,
    presentation: {
      what: reverted
        ? "The deposit transaction was mined but reverted, so no deposit was created."
        : "The deposit transaction was submitted, but its confirmation could not be verified.",
      funds: reverted
        ? `Your GLC was not taken — a reverted transaction moves no tokens, though the network fee was still spent. Transaction ${hash}.`
        : `Check transaction ${hash} on a Robinhood Network explorer before retrying — it may have already succeeded.`,
      next: diagnostic
        ? `If the explorer shows no successful deposit, try again. Reason: ${diagnostic}`
        : "If the explorer shows no successful deposit, try again.",
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

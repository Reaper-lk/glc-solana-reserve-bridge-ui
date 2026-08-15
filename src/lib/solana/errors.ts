import {
  WalletError,
  WalletNotReadyError,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletTimeoutError,
  WalletWindowClosedError,
  WalletWindowBlockedError,
} from "@solana/wallet-adapter-base";
import type { WalletFailure, WalletFailureCode } from "./types";

/**
 * Wallet errors, reduced to the product's three-part formula: what happened,
 * what it means for the user's funds, what to do next (acceptance criterion 3).
 *
 * Library error classes are consumed here and never re-exported. Callers
 * receive a `WalletFailure`, which is our own type.
 *
 * Connecting a wallet moves no money, so every funds line below can say so
 * plainly. That is worth stating explicitly rather than leaving the user to
 * infer it from a failed connection dialog.
 */

const FUNDS_UNAFFECTED =
  "No funds moved and nothing was signed. Connecting a wallet only shares your public address.";

/**
 * A user closing the wallet popup is a decision, not a fault. It is modelled as
 * a failure code so callers can recognise it, but it is deliberately NOT shown
 * as an error state — the UI returns quietly to idle.
 */
export function isUserRejection(failure: WalletFailure | null): boolean {
  return failure?.code === "user-rejected";
}

export function toWalletFailure(error: unknown): WalletFailure {
  const code = classify(error);

  switch (code) {
    case "not-installed":
      return {
        code,
        what: "That wallet is not installed in this browser.",
        funds: FUNDS_UNAFFECTED,
        next: "Install the wallet extension, then reload this page and try again.",
        retryable: false,
      };

    case "user-rejected":
      return {
        code,
        what: "The connection request was dismissed.",
        funds: FUNDS_UNAFFECTED,
        next: "Choose a wallet again when you are ready.",
        retryable: true,
      };

    case "timeout":
      return {
        code,
        what: "The wallet did not respond in time.",
        funds: FUNDS_UNAFFECTED,
        next: "Check that your wallet extension is unlocked, then try again.",
        retryable: true,
      };

    case "unsupported":
      return {
        code,
        what: "Wallet connection is not available in this browser.",
        funds: FUNDS_UNAFFECTED,
        next: "Use a desktop browser with a Solana wallet extension installed.",
        retryable: false,
      };

    case "connection-failed":
      return {
        code,
        what: "We could not connect to that wallet.",
        funds: FUNDS_UNAFFECTED,
        next: "Make sure the wallet is unlocked and try again, or choose a different wallet.",
        retryable: true,
      };

    default:
      return {
        code: "unknown",
        what: "Something went wrong connecting your wallet.",
        funds: FUNDS_UNAFFECTED,
        next: "Try again, or choose a different wallet.",
        retryable: true,
      };
  }
}

function classify(error: unknown): WalletFailureCode {
  if (error instanceof WalletNotReadyError) return "not-installed";
  if (error instanceof WalletDisconnectedError) return "connection-failed";
  if (error instanceof WalletTimeoutError) return "timeout";

  // Both mean the user shut the approval popup, deliberately or otherwise.
  if (error instanceof WalletWindowClosedError) return "user-rejected";
  if (error instanceof WalletWindowBlockedError) return "user-rejected";

  if (error instanceof WalletConnectionError) {
    return looksLikeRejection(error.message) ? "user-rejected" : "connection-failed";
  }

  if (error instanceof WalletError) {
    return looksLikeRejection(error.message) ? "user-rejected" : "connection-failed";
  }

  if (error instanceof Error && looksLikeRejection(error.message)) {
    return "user-rejected";
  }

  return "unknown";
}

/**
 * Wallets report user dismissal inconsistently and often only in the message.
 * Misreading a dismissal as a fault produces an alarming error for something
 * the user did on purpose, so the check is deliberately generous.
 */
function looksLikeRejection(message: string | undefined): boolean {
  if (!message) return false;
  return /reject|declin|denied|cancel|dismiss|user closed/i.test(message);
}

import { describe, expect, it } from "vitest";
import { requestStateSchema } from "@/lib/api/schemas/transfer";
import {
  happyPathFor,
  isFailureState,
  isKnownRequestState,
  isManualReview,
  isRefundState,
  isSuccessState,
  isTerminalState,
  isUnexercisedState,
  REQUEST_STATE_LABELS,
  transitionLabel,
} from "@/lib/bridge/state";

/**
 * These classifications are read against the real, ground-truth
 * `RequestState` wire enum (service/src/ledger/types.rs in
 * glc-solana-reserve-bridge) — every value the schema accepts must be
 * classified as exactly one of terminal/failure/manual-review/in-flight,
 * and every value must have a display label, so the UI never encounters an
 * unrenderable state.
 */
describe("RequestState classification", () => {
  const allStates = requestStateSchema.options;

  it("labels every possible wire state", () => {
    for (const state of allStates) {
      expect(REQUEST_STATE_LABELS[state]).toBeTruthy();
    }
  });

  it("classifies exactly the documented terminal states", () => {
    const terminal = allStates.filter(isTerminalState);
    expect(terminal.sort()).toEqual(
      [
        "Settled",
        "Expired",
        "Cancelled",
        "Reorged",
        "InsufficientReserveAtSettlement",
        "DestinationSubmissionFailed",
        "Refunded",
        "Failed",
      ].sort(),
    );
  });

  it("Settled is the only success state", () => {
    expect(allStates.filter(isSuccessState)).toEqual(["Settled"]);
  });

  it("ManualReview is not a failure and vice versa", () => {
    expect(isFailureState("ManualReview")).toBe(false);
    expect(isManualReview("Failed")).toBe(false);
    expect(isManualReview("ManualReview")).toBe(true);
  });

  it("models the whole refund lifecycle the backend actually emits", () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      expect(allStates).toContain(state);
      expect(isRefundState(state)).toBe(true);
    }
    expect(REQUEST_STATE_LABELS.RefundPending).toBe("Refund pending");
    expect(REQUEST_STATE_LABELS.RefundBroadcast).toBe("Refund broadcast");
    expect(REQUEST_STATE_LABELS.Refunded).toBe("Refunded");
  });

  it("never treats a refund as a failure — the deposit came back", () => {
    expect(isFailureState("RefundPending")).toBe(false);
    expect(isFailureState("RefundBroadcast")).toBe(false);
    expect(isFailureState("Refunded")).toBe(false);
  });

  it("treats Refunded as terminal but not as a settlement success", () => {
    expect(isTerminalState("Refunded")).toBe(true);
    expect(isSuccessState("Refunded")).toBe(false);
    expect(isTerminalState("RefundPending")).toBe(false);
    expect(isTerminalState("RefundBroadcast")).toBe(false);
  });

  it("classifies a refund as neither manual review nor an unexercised state", () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      expect(isManualReview(state)).toBe(false);
      expect(isUnexercisedState(state)).toBe(false);
    }
  });

  it("flags the settlement-pipeline states the backend does not yet drive", () => {
    expect(isUnexercisedState("SettlementAuthorized")).toBe(true);
    expect(isUnexercisedState("DestinationSubmitted")).toBe(true);
    expect(isUnexercisedState("DestinationConfirmed")).toBe(true);
    expect(isUnexercisedState("Settled")).toBe(true);
    expect(isUnexercisedState("AwaitingDeposit")).toBe(false);
  });
});

describe("happyPathFor", () => {
  it("includes Confirming for GlcToSol", () => {
    expect(happyPathFor("GlcToSol")).toContain("Confirming");
  });

  it("skips Confirming for SolToGlc (no confirmation ramp on that side)", () => {
    expect(happyPathFor("SolToGlc")).not.toContain("Confirming");
  });

  it("both sequences start awaiting deposit and end settled", () => {
    for (const direction of ["GlcToSol", "SolToGlc"] as const) {
      const sequence = happyPathFor(direction);
      expect(sequence[0]).toBe("AwaitingDeposit");
      expect(sequence[sequence.length - 1]).toBe("Settled");
    }
  });
});

describe("isKnownRequestState", () => {
  it("accepts every state on the wire enum", () => {
    for (const state of requestStateSchema.options) {
      expect(isKnownRequestState(state)).toBe(true);
    }
  });

  it("rejects a state this build does not model, so it can never index a state record", () => {
    expect(isKnownRequestState("SomeFutureLifecycleState")).toBe(false);
    expect(isKnownRequestState("")).toBe(false);
    // Not a state, but a real own-property of Object.prototype — a plain
    // object lookup would resolve it and hand back a function.
    expect(isKnownRequestState("toString")).toBe(false);
    expect(isKnownRequestState("constructor")).toBe(false);
  });
});

describe("transitionLabel", () => {
  it("names each refund transition the way the product describes it", () => {
    expect(transitionLabel("ManualReview", "RefundPending")).toBe("Refund started");
    expect(transitionLabel("RefundPending", "RefundBroadcast")).toBe("Refund broadcast");
    expect(transitionLabel("RefundBroadcast", "Refunded")).toBe("Refund confirmed");
  });

  it("invents nothing for a transition it has no wording for", () => {
    expect(transitionLabel(null, "AwaitingDeposit")).toBeNull();
    expect(transitionLabel("AwaitingDeposit", "Confirming")).toBeNull();
    // Same states, wrong direction — a reversed pair is not the same event.
    expect(transitionLabel("RefundPending", "ManualReview")).toBeNull();
    expect(transitionLabel("ManualReview", "SomeFutureLifecycleState")).toBeNull();
  });
});

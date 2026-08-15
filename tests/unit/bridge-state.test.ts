import { describe, expect, it } from "vitest";
import { requestStateSchema } from "@/lib/api/schemas/transfer";
import {
  happyPathFor,
  isFailureState,
  isManualReview,
  isSuccessState,
  isTerminalState,
  isUnexercisedState,
  REQUEST_STATE_LABELS,
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

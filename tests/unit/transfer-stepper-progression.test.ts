import { describe, expect, it } from "vitest";
import { happyPathFor, stepperStatusesFor, REQUEST_STATE_LABELS } from "@/lib/bridge";
import { requestStateSchema, type RequestState } from "@/lib/api/schemas/transfer";
import type { Route } from "@/lib/api/schemas/common";

/**
 * Request #4099 (`SolToGlc`, `DestinationConfirmed`) rendered with every
 * circle empty: the backend said the funds had reached the destination and
 * the stepper said nothing had happened yet.
 *
 * `DestinationConfirmed` was simply missing from `happyPathFor`, so the
 * component's `indexOf` returned -1 and its "unknown state" branch marked
 * the whole column pending. These tests read the mapping one state at a
 * time, in the terms a user sees, so a step that silently drops out of the
 * sequence fails here rather than in production.
 */

/** The labelled column a user would actually see, for one backend state. */
function column(route: Route, state: RequestState): [string, string][] {
  const steps = happyPathFor(route);
  const statuses = stepperStatusesFor(route, state);
  return steps.map((step, i) => [REQUEST_STATE_LABELS[step], statuses[i]!]);
}

describe("stepper progression — SolToGlc (the #4099 route)", () => {
  it("DestinationConfirmed marks everything before it done, itself current, Settled still pending", () => {
    // Exactly the progression the incident report asked for.
    expect(column("SolToGlc", "DestinationConfirmed")).toEqual([
      ["Awaiting your deposit", "done"],
      ["Deposit observed", "done"],
      ["Source confirmed", "done"],
      ["Settlement authorized", "done"],
      ["Sending your funds", "done"],
      ["Destination confirmed", "active"],
      ["Settled", "pending"],
    ]);
  });

  it("DestinationConfirmed never renders as 'nothing happened'", () => {
    // The literal regression: not one step may be pending before the
    // current one.
    const statuses = stepperStatusesFor("SolToGlc", "DestinationConfirmed");
    expect(statuses.every((s) => s === "pending")).toBe(false);
    expect(statuses.filter((s) => s === "done")).toHaveLength(5);
    expect(statuses.filter((s) => s === "active")).toHaveLength(1);
  });

  it("Settled shows every step complete, with none left active", () => {
    const statuses = stepperStatusesFor("SolToGlc", "Settled");
    expect(statuses.every((s) => s === "done")).toBe(true);
    expect(statuses).not.toContain("active");
  });

  it("AwaitingDeposit is the first step, current, with nothing yet done", () => {
    expect(column("SolToGlc", "AwaitingDeposit")).toEqual([
      ["Awaiting your deposit", "active"],
      ["Deposit observed", "pending"],
      ["Source confirmed", "pending"],
      ["Settlement authorized", "pending"],
      ["Sending your funds", "pending"],
      ["Destination confirmed", "pending"],
      ["Settled", "pending"],
    ]);
  });

  it.each([
    ["DepositObserved", 1],
    ["SourceFinalized", 2],
    ["SettlementAuthorized", 3],
    ["DestinationSubmitted", 4],
    ["DestinationConfirmed", 5],
  ] as const)("%s is step %i, with every earlier step done", (state, index) => {
    const statuses = stepperStatusesFor("SolToGlc", state);
    expect(statuses[index]).toBe("active");
    expect(statuses.slice(0, index).every((s) => s === "done")).toBe(true);
    expect(statuses.slice(index + 1).every((s) => s === "pending")).toBe(true);
  });

  it("advances monotonically — no state undoes a step an earlier one had completed", () => {
    const order: RequestState[] = [
      "AwaitingDeposit",
      "DepositObserved",
      "SourceFinalized",
      "SettlementAuthorized",
      "DestinationSubmitted",
      "DestinationConfirmed",
      "Settled",
    ];
    const doneCounts = order.map(
      (state) => stepperStatusesFor("SolToGlc", state).filter((s) => s === "done").length,
    );
    expect(doneCounts).toEqual([0, 1, 2, 3, 4, 5, 7]);
  });
});

describe("stepper progression — Goldcoin-sourced routes keep their Confirming step", () => {
  it("GlcToSol runs the same ladder with Confirming inserted", () => {
    expect(column("GlcToSol", "DestinationConfirmed")).toEqual([
      ["Awaiting your deposit", "done"],
      ["Deposit observed", "done"],
      ["Confirming", "done"],
      ["Source confirmed", "done"],
      ["Settlement authorized", "done"],
      ["Sending your funds", "done"],
      ["Destination confirmed", "active"],
      ["Settled", "pending"],
    ]);
  });

  it("Confirming is current on a Goldcoin source, and absent from a contract source", () => {
    expect(stepperStatusesFor("GlcToSol", "Confirming")[2]).toBe("active");
    expect(happyPathFor("SolToGlc")).not.toContain("Confirming");
  });
});

describe("states that are not normal progress", () => {
  /**
   * These never reach the stepper — `TransferDetail` renders an Alert
   * instead — but the mapping must still refuse to invent a position for
   * them rather than landing somewhere arbitrary if that ever changes.
   */
  it.each(["ManualReview", "RefundPending", "RefundBroadcast", "Refunded"] as const)(
    "%s claims no progress on the happy path",
    (state) => {
      expect(stepperStatusesFor("SolToGlc", state).every((s) => s === "pending")).toBe(
        true,
      );
    },
  );

  it.each([
    "Expired",
    "Cancelled",
    "Reorged",
    "Failed",
    "DestinationSubmissionFailed",
  ] as const)("%s claims no progress on the happy path", (state) => {
    expect(stepperStatusesFor("SolToGlc", state).every((s) => s === "pending")).toBe(
      true,
    );
  });

  it("LiquidityReserved precedes the deposit, so nothing is marked done", () => {
    expect(
      stepperStatusesFor("SolToGlc", "LiquidityReserved").every((s) => s === "pending"),
    ).toBe(true);
  });
});

describe("total coverage", () => {
  it("renders every wire state on every route without throwing or returning a short column", () => {
    const routes: Route[] = ["SolToGlc", "GlcToSol", "RhnToGlc", "GlcToRhn"];
    for (const route of routes) {
      const expectedLength = happyPathFor(route).length;
      for (const state of requestStateSchema.options) {
        const statuses = stepperStatusesFor(route, state);
        expect(statuses).toHaveLength(expectedLength);
        expect(statuses.every((s) => ["done", "active", "pending"].includes(s))).toBe(
          true,
        );
      }
    }
  });

  it("never marks more than one step active", () => {
    for (const state of requestStateSchema.options) {
      const active = stepperStatusesFor("SolToGlc", state).filter((s) => s === "active");
      expect(active.length).toBeLessThanOrEqual(1);
    }
  });
});

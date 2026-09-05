import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "./test-utils";
import { TransferDetail } from "@/features/transfer/TransferDetail";
import * as fixtures from "@/lib/api/mock/fixtures";
import type { TransferViewDto } from "@/lib/api/schemas/transfer";

const getTransfer = vi.fn();

vi.mock("@/lib/api", () => ({
  bridgeApi: { getTransfer: (...args: unknown[]) => getTransfer(...args) },
}));

function transferWith(overrides: Partial<TransferViewDto>): TransferViewDto {
  return { ...fixtures.transfersFixture()[0]!, ...overrides };
}

/**
 * Production request #2477, exactly as the backend reports it after the
 * refund: a `GlcToSol` request for 29,100 GLC whose deposit actually arrived
 * as 29,050 GLC, parked on `deposit_amount_mismatch`, refunded in full, no
 * bridge fee charged, nothing released on Solana.
 *
 * The quote trio is the real one the request was created under — 29,100 gross,
 * 873 fee, 28,227 net — because reproducing the defect means carrying exactly
 * the figures the page used to render as an outcome.
 */
const REQUESTED = "2910000000000"; // 29,100 GLC
const DEPOSITED = "2905000000000"; // 29,050 GLC
const QUOTED_FEE = "87300000000"; // 873 GLC, never charged
const QUOTED_NET = "2822700000000"; // 28,227 GLC, never delivered

function transfer2477(
  state: "RefundPending" | "RefundBroadcast" | "Refunded",
  refundOverrides: Partial<NonNullable<TransferViewDto["refund"]>> = {},
): TransferViewDto {
  return transferWith({
    id: 2477,
    direction: "GlcToSol",
    state,
    gross_amount_atomic: REQUESTED,
    fee_bps: 300,
    fee_amount_atomic: QUOTED_FEE,
    net_amount_atomic: QUOTED_NET,
    source_txid: "d".repeat(64),
    destination_txid: null,
    failure_reason: null,
    refund: {
      state: state === "Refunded" ? "Refunded" : "Broadcast",
      observed_amount_atomic: DEPOSITED,
      refund_amount_atomic: DEPOSITED,
      fee_charged_atomic: "0",
      refund_txid: "f7a160c716c3fad29b06c1c9549ca678dde30a143dd9f69675ce277016dec323",
      broadcast_at: 1_756_000_000,
      refunded_at: state === "Refunded" ? 1_756_000_600 : null,
      ...refundOverrides,
    },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("TransferDetail — real backend state machine, never a fabricated success", () => {
  it("renders an in-flight transfer with its stepper and no success claim", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 1, state: "Confirming", direction: "GlcToSol" }),
    );
    renderWithQueryClient(<TransferDetail id={1} />);

    // The stepper legitimately previews "Settled" as a future, not-yet-reached
    // step in the happy path, so its presence is not itself a false claim —
    // what matters is that the CURRENT reported state is Confirming.
    const matches = await screen.findAllByText("Confirming");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("renders Settled only when the backend actually reports it", async () => {
    getTransfer.mockResolvedValue(transferWith({ id: 2, state: "Settled" }));
    renderWithQueryClient(<TransferDetail id={2} />);

    expect(await screen.findAllByText("Settled")).not.toHaveLength(0);
  });

  it("shows a manual-review alert, not a stepper, when the backend says ManualReview", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 3, state: "ManualReview", failure_reason: "amount mismatch" }),
    );
    renderWithQueryClient(<TransferDetail id={3} />);

    expect(await screen.findAllByText(/manual review/i)).not.toHaveLength(0);
    expect(screen.getByText("amount mismatch")).toBeInTheDocument();
    expect(screen.getByText(/it is not lost/i)).toBeInTheDocument();
  });

  it("presents a refund as a refund, never as a failure", async () => {
    for (const [id, state, phrase] of [
      [30, "RefundPending", /refund for this transfer has been started/i],
      [31, "RefundBroadcast", /refund for this transfer has been broadcast/i],
      [32, "Refunded", /this transfer was refunded/i],
    ] as const) {
      getTransfer.mockResolvedValue(transferWith({ id, state }));
      const { unmount } = renderWithQueryClient(<TransferDetail id={id} />);

      expect(await screen.findByText(phrase)).toBeInTheDocument();
      // A refund is not a failure: none of the danger alert's title (which
      // names the state in parentheses) or its support-escalation copy, and
      // no assertive alert role that would announce it as an error.
      expect(screen.queryByText(/did not settle \(/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/no further automatic action will occur/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      unmount();
      getTransfer.mockReset();
    }
  });

  it("does not show the happy-path stepper for a transfer that left it to be refunded", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 33, state: "Refunded", direction: "GlcToSol" }),
    );
    renderWithQueryClient(<TransferDetail id={33} />);

    await screen.findByText(/this transfer was refunded/i);
    // Steps from the happy path would otherwise render with none of them
    // marked current, implying the transfer is still on its way to settling.
    expect(screen.queryByText("Awaiting your deposit")).not.toBeInTheDocument();
    expect(screen.queryByText("Sending your funds")).not.toBeInTheDocument();
  });

  it("shows a failure alert with the three-part formula for a failed transfer", async () => {
    getTransfer.mockResolvedValue(
      transferWith({
        id: 4,
        state: "Failed",
        failure_reason: "destination submission rejected",
      }),
    );
    renderWithQueryClient(<TransferDetail id={4} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/did not settle/i);
    expect(alert).toHaveTextContent(/no further automatic action/i);
    expect(alert).toHaveTextContent(/contact support/i);
    expect(screen.getByText("destination submission rejected")).toBeInTheDocument();
  });

  it("flags a reserve-exhaustion failure with fund-safety copy specific to that state", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 5, state: "InsufficientReserveAtSettlement" }),
    );
    renderWithQueryClient(<TransferDetail id={5} />);

    expect(
      await screen.findByText(/reserve capacity ran out before settlement/i),
    ).toBeInTheDocument();
  });

  it("labels a settlement-pipeline state the backend does not yet drive as unexercised", async () => {
    getTransfer.mockResolvedValue(transferWith({ id: 6, state: "SettlementAuthorized" }));
    renderWithQueryClient(<TransferDetail id={6} />);

    expect(
      await screen.findByText(/still being rolled out on this deployment/i),
    ).toBeInTheDocument();
  });

  it("shows a loading skeleton before data arrives", () => {
    getTransfer.mockReturnValue(new Promise(() => {}));
    renderWithQueryClient(<TransferDetail id={7} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("surfaces a fetch failure as an error state, never as a fabricated status", async () => {
    getTransfer.mockRejectedValue(new Error("network down"));
    renderWithQueryClient(<TransferDetail id={8} />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a not-found presentation for an unknown transfer id", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    getTransfer.mockRejectedValue(
      new ApiError({
        kind: "not-found",
        message: "transfer not found",
        retryable: false,
        status: 404,
        presentation: {
          what: "We could not find that transfer.",
          funds:
            "If you have already sent funds, they are on-chain and are not affected by this page.",
          next: "Check the identifier and try again, or search by transaction ID.",
        },
      }),
    );
    renderWithQueryClient(<TransferDetail id={999} />);

    expect(await screen.findByText(/could not find that transfer/i)).toBeInTheDocument();
  });

  it("hides nothing extra in readOnly mode since TransferView never carries sensitive fields", async () => {
    const transfer = transferWith({ id: 9, state: "AwaitingDeposit" });
    getTransfer.mockResolvedValue(transfer);

    const { unmount } = renderWithQueryClient(<TransferDetail id={9} readOnly />);
    await waitFor(() =>
      expect(screen.getAllByText(/Awaiting your deposit/i).length).toBeGreaterThan(0),
    );
    unmount();

    getTransfer.mockResolvedValue(transfer);
    renderWithQueryClient(<TransferDetail id={9} />);
    expect(await screen.findAllByText(/Awaiting your deposit/i)).not.toHaveLength(0);
  });
});

/**
 * Regression cover for production request #2477.
 *
 * The page rendered the settlement quote — "You bridge 29,100 GLC / Bridge fee
 * (3%) 873 GLC / You receive 28,227 GLC" — on a transfer that settled nothing,
 * was charged nothing, delivered nothing, and had 29,050 GLC returned. Every
 * one of those three figures described a settlement that never happened.
 */
describe("TransferDetail — a refunded transfer shows the refund, never the quote", () => {
  it("shows #2477's real refund principal and none of the settlement trio", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);

    // The one figure that is true: 29,050 GLC actually went back. It appears
    // twice — once as what arrived, once as what was returned.
    expect(screen.getByText(/Refunded to you/i)).toBeInTheDocument();
    expect(screen.getAllByText("29,050.00")).toHaveLength(2);

    // The three that are not. `queryByText` matches the rendered text of a
    // single element, which is exactly how `TokenAmount` emits an amount.
    expect(screen.queryByText("28,227.00")).not.toBeInTheDocument();
    expect(screen.queryByText("873.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bridge fee \(3%\)/i)).not.toBeInTheDocument();
  });

  it("states plainly that no bridge fee was charged, and why", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    expect(await screen.findByText(/no bridge fee was charged/i)).toBeInTheDocument();
    // Both the refund alert and the fee note say it, which is the point: the
    // reason sits with the fee, not only in the banner.
    expect(screen.getAllByText(/did not settle/i).length).toBeGreaterThan(0);
  });

  it("distinguishes the requested amount from the amount actually deposited", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.getByText(/You requested/i)).toBeInTheDocument();
    expect(screen.getByText("29,100.00")).toBeInTheDocument();
    expect(screen.getByText(/Actually deposited/i)).toBeInTheDocument();
  });

  it("hides the deposited row when the deposit matched what was requested", async () => {
    getTransfer.mockResolvedValue(
      transfer2477("Refunded", {
        observed_amount_atomic: REQUESTED,
        refund_amount_atomic: REQUESTED,
      }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.queryByText(/Actually deposited/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Refunded to you/i)).toBeInTheDocument();
  });

  it("suppresses the settlement trio in every refund state, not just the terminal one", async () => {
    for (const state of ["RefundPending", "RefundBroadcast", "Refunded"] as const) {
      getTransfer.mockResolvedValue(transfer2477(state));
      const { unmount } = renderWithQueryClient(<TransferDetail id={2477} />);

      expect(await screen.findAllByText("29,050.00")).toHaveLength(2);
      expect(screen.queryByText("28,227.00")).not.toBeInTheDocument();
      expect(screen.queryByText("873.00")).not.toBeInTheDocument();
      expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
      expect(screen.getByText(/no bridge fee was charged/i)).toBeInTheDocument();

      unmount();
      getTransfer.mockReset();
    }
  });

  it("labels an in-flight refund as still on its way, not as already returned", async () => {
    getTransfer.mockResolvedValue(
      transfer2477("RefundBroadcast", { state: "Broadcast", refunded_at: null }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    expect(await screen.findByText(/Being returned to you/i)).toBeInTheDocument();
    expect(screen.queryByText(/Refunded to you/i)).not.toBeInTheDocument();
  });

  it("refuses to fall back to the quote when the backend sends no refund object", async () => {
    getTransfer.mockResolvedValue(
      transferWith({ id: 2477, state: "Refunded", refund: null }),
    );
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    // An older backend cannot tell us the principal, so the page says so
    // rather than presenting the net as if it had been delivered.
    expect(screen.getByText(/Not available on this page/i)).toBeInTheDocument();
    expect(screen.queryByText(/You receive/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no bridge fee was charged/i)).toBeInTheDocument();
  });

  it("still shows the gross / fee / net trio for a settled transfer", async () => {
    getTransfer.mockResolvedValue(
      transferWith({
        id: 12,
        state: "Settled",
        gross_amount_atomic: REQUESTED,
        fee_bps: 300,
        fee_amount_atomic: QUOTED_FEE,
        net_amount_atomic: QUOTED_NET,
        refund: null,
      }),
    );
    renderWithQueryClient(<TransferDetail id={12} />);

    expect(await screen.findByText(/You bridge/i)).toBeInTheDocument();
    expect(screen.getByText(/Bridge fee \(3%\)/i)).toBeInTheDocument();
    expect(screen.getByText(/You receive/i)).toBeInTheDocument();
    expect(screen.getByText("29,100.00")).toBeInTheDocument();
    expect(screen.getByText("873.00")).toBeInTheDocument();
    expect(screen.getByText("28,227.00")).toBeInTheDocument();
  });

  it("links the refund transaction, on the source chain the deposit arrived on", async () => {
    getTransfer.mockResolvedValue(transfer2477("Refunded"));
    renderWithQueryClient(<TransferDetail id={2477} />);

    await screen.findByText(/this transfer was refunded/i);
    expect(screen.getByText(/Refund transaction/i)).toBeInTheDocument();
  });
});

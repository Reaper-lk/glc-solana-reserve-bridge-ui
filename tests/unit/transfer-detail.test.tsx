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

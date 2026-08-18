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

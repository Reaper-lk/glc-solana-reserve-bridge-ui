"use client";

import {
  Alert,
  Card,
  ErrorState,
  Skeleton,
  StatusBadge,
  TokenAmount,
} from "@/components/ui";
import { useTransfer } from "@/lib/query/hooks";
import { requestStateStatus } from "@/lib/status";
import {
  directions,
  isFailureState,
  isManualReview,
  isUnexercisedState,
} from "@/lib/bridge";
import { goldcoinTxUrl, solanaTxUrl } from "@/lib/config/links";
import { TransferStepper } from "./TransferStepper";

/**
 * Reconstructed entirely from `GET /transfers/:id` plus the id in the URL —
 * there is no local state to lose, so this survives a reload, a device
 * switch, or a link opened days later.
 *
 * `readOnly` is used by the public explorer route: it is the same component
 * with nothing hidden, because `TransferView` never carries a recipient
 * address or anything else sensitive to begin with (backend module doc,
 * service/src/api.rs).
 */
export function TransferDetail({
  id,
  readOnly = false,
}: {
  id: number;
  readOnly?: boolean;
}) {
  const query = useTransfer(id);

  if (query.isPending) {
    return (
      <Card>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-4 h-32 w-full" />
      </Card>
    );
  }

  if (query.isError) return <ErrorState error={query.error} />;

  const transfer = query.data;
  const descriptor = directions[transfer.direction];
  const sourceToken = descriptor.from.token;
  const destToken = descriptor.to.token;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-heading-2">
            {descriptor.label} <span className="text-ink-400">#{transfer.id}</span>
          </h1>
          <p className="text-body-sm text-ink-500">
            Created {new Date(transfer.created_at * 1000).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={requestStateStatus[transfer.state]} />
      </div>

      {isFailureState(transfer.state) && (
        <Alert
          level="danger"
          title={`This transfer did not settle (${transfer.state}).`}
          funds={
            transfer.state === "InsufficientReserveAtSettlement"
              ? "Reserve capacity ran out before settlement could complete. Your deposit is not lost — contact support with this transfer id."
              : "No further automatic action will occur on this transfer. If you already deposited funds, they are not lost — contact support with this transfer id."
          }
          next="Contact support with this transfer id if you believe funds are affected."
        >
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {isManualReview(transfer.state) && (
        <Alert
          level="warn"
          title="This transfer is under manual review."
          funds="Your deposit has been observed. It is being reviewed before settlement continues — it is not lost."
          next="No action is needed. Check back here for updates, or contact support with this transfer id."
        >
          {transfer.failure_reason && <p>{transfer.failure_reason}</p>}
        </Alert>
      )}

      {!isFailureState(transfer.state) && !isManualReview(transfer.state) && (
        <TransferStepper
          direction={transfer.direction}
          state={transfer.state}
          sourceConfirmations={transfer.source_confirmations}
          requiredSourceConfirmations={transfer.required_source_confirmations}
        />
      )}

      {isUnexercisedState(transfer.state) && (
        <p className="text-body-sm text-ink-500 mt-2">
          This state is part of the settlement pipeline that is still being rolled out on
          this deployment — the transfer is real and being tracked, but automatic progress
          past this point is not yet guaranteed.
        </p>
      )}

      <dl className="border-ink-100 mt-6 grid grid-cols-2 gap-4 border-t pt-4">
        <div>
          <dt className="text-body-sm text-ink-500">Gross amount</dt>
          <dd>
            <TokenAmount
              raw={String(transfer.gross_amount_atomic)}
              decimals={sourceToken.decimals}
              symbol={sourceToken.symbol}
            />
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">You receive</dt>
          <dd>
            <TokenAmount
              raw={String(transfer.net_amount_atomic)}
              decimals={destToken.decimals}
              symbol={destToken.symbol}
            />
          </dd>
        </div>
        {transfer.source_txid && (
          <div className="col-span-2">
            <dt className="text-body-sm text-ink-500">Source transaction</dt>
            <dd className="text-mono-sm break-all">
              {!readOnly &&
              (transfer.direction === "GlcToSol"
                ? goldcoinTxUrl(transfer.source_txid)
                : solanaTxUrl(transfer.source_txid)) ? (
                <a
                  href={
                    (transfer.direction === "GlcToSol"
                      ? goldcoinTxUrl(transfer.source_txid)
                      : solanaTxUrl(transfer.source_txid)) ?? undefined
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {transfer.source_txid}
                </a>
              ) : (
                transfer.source_txid
              )}
            </dd>
          </div>
        )}
        {transfer.destination_txid && (
          <div className="col-span-2">
            <dt className="text-body-sm text-ink-500">Destination transaction</dt>
            <dd className="text-mono-sm break-all">{transfer.destination_txid}</dd>
          </div>
        )}
      </dl>
    </Card>
  );
}

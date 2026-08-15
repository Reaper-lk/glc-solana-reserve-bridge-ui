"use client";

import {
  AddressCompact,
  Alert,
  Card,
  CopyButton,
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
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { TransferStepper } from "./TransferStepper";

/**
 * `TransferView`'s `gross_amount_atomic`/`fee_amount_atomic`/
 * `net_amount_atomic` are all the ledger's own canonical accounting unit
 * (Goldcoin's 8 decimals, docs/20-bridge-fee.md) regardless of direction —
 * unlike `QuoteOutput`, this endpoint has no per-direction
 * source/destination decimals or pre-formatted display strings, so
 * formatting any of the three with the destination token's own decimals
 * (6 for Solana) understates or overstates the figure by orders of
 * magnitude. All three render at canonical decimals here; both tokens
 * already share the symbol "GLC".
 */
const CANONICAL_SYMBOL = "GLC";

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

  return (
    <Card variant="raised" padding="lg">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading-2">
            {descriptor.label} <span className="text-ink-500">#{transfer.id}</span>
          </h1>
          <div className="text-body-sm text-ink-500 mt-1 flex flex-wrap items-center gap-x-1 gap-y-1">
            <span>Created {new Date(transfer.created_at * 1000).toLocaleString()}</span>
            <CopyButton
              value={String(transfer.id)}
              label="request id"
              className="px-1.5 py-0.5"
            >
              Copy ID
            </CopyButton>
          </div>
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

      <dl className="border-ink-100 mt-6 grid grid-cols-3 gap-4 border-t pt-4">
        <div>
          <dt className="text-body-sm text-ink-500">You bridge</dt>
          <dd>
            <TokenAmount
              raw={String(transfer.gross_amount_atomic)}
              decimals={GOLDCOIN_DECIMALS}
              symbol={CANONICAL_SYMBOL}
            />
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">
            Bridge fee (
            {(transfer.fee_bps / 100).toFixed(transfer.fee_bps % 100 === 0 ? 0 : 2)}%)
          </dt>
          <dd className="text-ink-600">
            <TokenAmount
              raw={String(transfer.fee_amount_atomic)}
              decimals={GOLDCOIN_DECIMALS}
              symbol={CANONICAL_SYMBOL}
            />
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">You receive</dt>
          <dd className="text-ink-950 font-medium">
            <TokenAmount
              raw={String(transfer.net_amount_atomic)}
              decimals={GOLDCOIN_DECIMALS}
              symbol={CANONICAL_SYMBOL}
            />
          </dd>
        </div>

        {transfer.source_txid && (
          <TxRow
            label="Source transaction"
            txid={transfer.source_txid}
            href={
              readOnly
                ? undefined
                : ((transfer.direction === "GlcToSol"
                    ? goldcoinTxUrl(transfer.source_txid)
                    : solanaTxUrl(transfer.source_txid)) ?? undefined)
            }
          />
        )}
        {transfer.destination_txid && (
          <TxRow
            label="Destination transaction"
            txid={transfer.destination_txid}
            href={
              readOnly
                ? undefined
                : ((transfer.direction === "GlcToSol"
                    ? solanaTxUrl(transfer.destination_txid)
                    : goldcoinTxUrl(transfer.destination_txid)) ?? undefined)
            }
          />
        )}
      </dl>
    </Card>
  );
}

function TxRow({
  label,
  txid,
  href,
}: {
  label: string;
  txid: string;
  href?: string | undefined;
}) {
  return (
    <div className="border-ink-100 col-span-3 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
      <div>
        <dt className="text-body-sm text-ink-500">{label}</dt>
        <dd className="mt-0.5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="decoration-ink-300 hover:decoration-ink-600 underline underline-offset-2"
            >
              <AddressCompact address={txid} lead={10} tail={8} />
            </a>
          ) : (
            <AddressCompact address={txid} lead={10} tail={8} />
          )}
        </dd>
      </div>
      <CopyButton value={txid} label={label.toLowerCase()} />
    </div>
  );
}

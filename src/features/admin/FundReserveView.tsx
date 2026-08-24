"use client";

import { useState } from "react";
import { Alert, Button, Card, ErrorState, TokenAmount } from "@/components/ui";
import { AddressCompact } from "@/components/ui/AddressChunks";
import { WalletButton } from "@/features/wallet/WalletButton";
import {
  glcToAtomic,
  isValidAddress,
  RESERVE_MINT_DECIMALS,
  RESERVE_TOKEN_ACCOUNT_ADDRESS,
  useFundReserve,
  useReserveTokenAccountBalance,
  useTokenBalance,
  useWalletConnection,
} from "@/lib/solana";
import { env } from "@/lib/config/env";

// Never rendered without the exact value matching this constant — a
// second, independent guard alongside `assertIsReserveTokenAccount` inside
// `src/lib/solana/fund-reserve.ts`, so a mistake in one layer does not
// silently become the only thing standing between an operator and the
// wrong account.
if (!isValidAddress(RESERVE_TOKEN_ACCOUNT_ADDRESS)) {
  throw new Error("RESERVE_TOKEN_ACCOUNT_ADDRESS is not a valid Solana address");
}

type Phase =
  { kind: "form" } | { kind: "confirm" } | { kind: "success"; signature: string };

export function FundReserveView() {
  const wallet = useWalletConnection();
  const walletBalance = useTokenBalance();
  const reserveBalance = useReserveTokenAccountBalance();
  const fundReserve = useFundReserve();

  const [amountInput, setAmountInput] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (wallet.status === "unconfigured") {
    return (
      <Alert
        level="warn"
        title="Solana is not configured for this deployment."
        funds="No funds moved."
        next="This deployment has no NEXT_PUBLIC_SOLANA_RPC_URL configured."
      />
    );
  }

  if (wallet.status === "initialising") {
    return <div className="h-40" aria-hidden="true" />;
  }

  if (wallet.status !== "connected" || !wallet.address) {
    return (
      <Card variant="raised" padding="lg" className="flex flex-col items-start gap-4">
        <p className="text-body text-ink-700">
          Connect the operator&apos;s Phantom wallet to continue.
        </p>
        <WalletButton />
      </Card>
    );
  }

  const walletAddress = wallet.address;

  let amountAtomic: bigint | null = null;
  let amountError: string | null = null;
  if (amountInput.trim().length > 0) {
    try {
      amountAtomic = glcToAtomic(amountInput);
    } catch (error) {
      amountError = error instanceof Error ? error.message : "Invalid amount.";
    }
  }

  const canReview = amountAtomic !== null && amountError === null && fundReserve.canSign;

  async function handleConfirmAndSign() {
    if (amountInput.trim().length === 0) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await fundReserve.fund({ amountGlc: amountInput });
      setPhase({ kind: "success", signature: result.signature });
      void walletBalance.refetch();
      void reserveBalance.refetch();
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "success") {
    return (
      <Card variant="raised" padding="lg" className="flex flex-col gap-4">
        <Alert
          level="success"
          title="Reserve funded."
          funds={`${amountInput} GLC sent to the reserve token account.`}
          next="The reserve balance below has been refreshed."
        />
        <div>
          <p className="text-body-sm text-ink-600 mb-1">Transaction signature</p>
          <p className="text-mono-sm break-all">{phase.signature}</p>
        </div>
        <div>
          <p className="text-body-sm text-ink-600 mb-1">Reserve balance</p>
          {reserveBalance.data && (
            <TokenAmount
              raw={reserveBalance.data.raw}
              decimals={reserveBalance.data.decimals}
              symbol={reserveBalance.data.symbol}
              className="text-heading-3"
            />
          )}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setPhase({ kind: "form" });
            setAmountInput("");
          }}
        >
          Fund again
        </Button>
      </Card>
    );
  }

  if (phase.kind === "confirm") {
    return (
      <Card variant="raised" padding="lg" className="flex flex-col gap-4">
        <Alert
          level="warn"
          title="You are funding the Solana bridge reserve"
          funds="This sends real GLC out of the connected wallet. This action cannot be undone once signed."
          next="Review every field below before signing in Phantom."
        />
        <dl className="flex flex-col gap-3">
          <div>
            <dt className="text-body-sm text-ink-600">Amount</dt>
            <dd className="text-heading-3 tabular">{amountInput} GLC</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-600">Mint</dt>
            <dd className="text-mono-sm break-all">{env.reserveMintAddress}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-600">Exact destination token account</dt>
            <dd className="text-mono-sm break-all">{RESERVE_TOKEN_ACCOUNT_ADDRESS}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-600">Signing wallet</dt>
            <dd className="text-mono-sm break-all">{walletAddress}</dd>
          </div>
        </dl>
        {submitError !== null && <ErrorState error={submitError} />}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => setPhase({ kind: "form" })}
            {...(submitting
              ? {
                  disabled: true,
                  disabledReason: "A transaction is being submitted.",
                }
              : {})}
          >
            Back
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            onClick={() => void handleConfirmAndSign()}
          >
            Confirm &amp; sign in Phantom
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="raised" padding="lg" className="flex flex-col gap-5">
      <div>
        <p className="text-body-sm text-ink-600">Connected Phantom address</p>
        <AddressCompact address={walletAddress} lead={6} tail={6} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-body-sm text-ink-600">Your GLC balance</p>
          {walletBalance.data ? (
            <TokenAmount
              raw={walletBalance.data.raw}
              decimals={walletBalance.data.decimals}
              symbol={walletBalance.data.symbol}
              className="text-heading-3"
            />
          ) : (
            <p className="text-body text-ink-400">—</p>
          )}
        </div>
        <div>
          <p className="text-body-sm text-ink-600">Reserve GLC balance</p>
          {reserveBalance.data ? (
            <TokenAmount
              raw={reserveBalance.data.raw}
              decimals={reserveBalance.data.decimals}
              symbol={reserveBalance.data.symbol}
              className="text-heading-3"
            />
          ) : (
            <p className="text-body text-ink-400">—</p>
          )}
        </div>
      </div>

      <div>
        <p className="text-body-sm text-ink-600">Reserve token account</p>
        <p className="text-mono-sm break-all">{RESERVE_TOKEN_ACCOUNT_ADDRESS}</p>
      </div>

      <div>
        <label htmlFor="fund-amount" className="text-body-sm text-ink-600 mb-1 block">
          Amount to send
        </label>
        <div className="border-ink-200 focus-within:border-ink-400 flex items-center rounded-lg border px-3 py-2.5 transition-colors">
          <input
            id="fund-amount"
            aria-label="Amount in GLC"
            inputMode="decimal"
            placeholder="0.00"
            className="text-heading-2 tabular min-w-0 flex-1 rounded-lg outline-none"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
          />
          <span className="text-body text-ink-500 font-medium">GLC</span>
        </div>
        {amountError && (
          <p className="text-body-sm text-danger-700 mt-1">{amountError}</p>
        )}
        <p className="text-body-sm text-ink-500 mt-1">
          {RESERVE_MINT_DECIMALS} decimal places, sent as Token-2022 `TransferChecked`.
        </p>
      </div>

      <Button
        variant="primary"
        size="lg"
        {...(!canReview
          ? {
              disabled: true,
              disabledReason: amountError ?? "Enter an amount to continue.",
            }
          : {})}
        onClick={() => setPhase({ kind: "confirm" })}
      >
        Review
      </Button>
    </Card>
  );
}

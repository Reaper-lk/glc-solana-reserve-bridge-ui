"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, ErrorState } from "@/components/ui";
import {
  directions,
  display,
  goldcoinAddressRules,
  isReportableAddressProblem,
  isReportableProblem,
  validateAmount,
  validateGoldcoinAddress,
} from "@/lib/bridge";
import {
  canonicalToSourceRawCeil,
  canonicalToSourceRawExact,
  canonicalToSourceRawFloor,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";
import {
  useBridgeStatus,
  useCreateTransfer,
  useLimits,
  useQuote,
  useReserve,
} from "@/lib/query/hooks";
import { isValidAddress, useDepositToReserve, useWalletConnection } from "@/lib/solana";
import { bridgeApi } from "@/lib/api";
import type { Direction } from "@/lib/api/schemas/common";
import { DirectionSelector } from "./DirectionSelector";
import { QuoteBreakdown } from "./QuoteBreakdown";
import { DepositInstructions } from "./DepositInstructions";
import { ExchangeAddressWarning } from "./ExchangeAddressWarning";

type Phase =
  | { kind: "form" }
  | {
      kind: "glc-to-sol-deposit";
      requestId: number;
      depositVaultAddress: string;
      depositBindingHex: string;
    }
  | { kind: "sol-to-glc-waiting"; signature: string };

export function BridgeCard() {
  const router = useRouter();
  const wallet = useWalletConnection();

  const [direction, setDirection] = useState<Direction>("GlcToSol");
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const descriptor = directions[direction];
  const sourceToken = descriptor.from.token;

  const status = useBridgeStatus();
  const limits = useLimits();
  const reserve = useReserve();
  const createTransfer = useCreateTransfer();
  const depositToReserve = useDepositToReserve();

  const amountBounds = useMemo(() => {
    if (!limits.data) return null;
    const minimum = canonicalToSourceRawCeil(
      String(limits.data.min_transfer_amount),
      sourceToken.decimals,
    );
    const maximum = canonicalToSourceRawFloor(
      String(limits.data.per_transfer_limit),
      sourceToken.decimals,
    );
    return {
      decimals: sourceToken.decimals,
      symbol: sourceToken.symbol,
      minimum,
      maximum,
    };
  }, [limits.data, sourceToken]);

  const amountValidation = amountBounds
    ? validateAmount(amountInput, amountBounds)
    : null;
  const canonicalGrossAmount =
    amountValidation?.raw !== null && amountValidation?.raw !== undefined
      ? Number(sourceRawToCanonical(amountValidation.raw, sourceToken.decimals))
      : 0;

  const quote = useQuote(direction, canonicalGrossAmount);

  const recipientValidation = useMemo(() => {
    if (direction === "GlcToSol") {
      if (recipient.trim().length === 0) return { valid: false, message: null };
      if (!isValidAddress(recipient.trim())) {
        return { valid: false, message: "That is not a valid Solana address." };
      }
      return { valid: true, message: null };
    }
    const result = validateGoldcoinAddress(recipient, goldcoinAddressRules());
    return {
      valid: result.valid,
      message: isReportableAddressProblem(result.problem) ? result.message : null,
    };
  }, [direction, recipient]);

  const destinationReserveCapacity = reserve.data
    ? descriptor.destinationReserve === "solana"
      ? reserve.data.solana_available_capacity
      : reserve.data.goldcoin_available_capacity
    : null;

  const directionAvailable =
    direction === "GlcToSol"
      ? status.data?.glc_to_sol_available
      : status.data?.sol_to_glc_available;

  const gate = useMemo(() => {
    if (status.isPending || limits.isPending || reserve.isPending) {
      return { can: false, reason: "Loading bridge status…" };
    }
    if (status.isError) return { can: false, reason: "Bridge status is unavailable." };
    if (directionAvailable === false) {
      return {
        can: false,
        reason: `${descriptor.label} is currently paused or unavailable.`,
      };
    }
    if (destinationReserveCapacity !== null && destinationReserveCapacity <= 0) {
      return {
        can: false,
        reason: "Insufficient reserve liquidity for this direction right now.",
      };
    }
    if (!amountValidation || amountValidation.raw === null) {
      return {
        can: false,
        reason: isReportableProblem(amountValidation?.problem ?? null)
          ? amountValidation!.message!
          : "Enter an amount.",
      };
    }
    if (!recipientValidation.valid) {
      return {
        can: false,
        reason: recipientValidation.message ?? "Enter a destination address.",
      };
    }
    if (direction === "SolToGlc") {
      const capability = depositToReserve.capability(
        new TextEncoder().encode(recipient.trim()).length,
      );
      if (!capability.available)
        return {
          can: false,
          reason: capability.message ?? "This direction is unavailable.",
        };
    }
    if (quote.isPending) return { can: false, reason: "Fetching quote…" };
    if (quote.isError)
      return { can: false, reason: "Could not fetch a quote for this amount." };
    return { can: true, reason: null };
  }, [
    status.isPending,
    status.isError,
    limits.isPending,
    reserve.isPending,
    directionAvailable,
    destinationReserveCapacity,
    amountValidation,
    recipientValidation,
    direction,
    recipient,
    depositToReserve,
    quote.isPending,
    quote.isError,
    descriptor.label,
  ]);

  async function submit() {
    if (!gate.can || !amountValidation?.raw) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (direction === "GlcToSol") {
        const output = await createTransfer.mutateAsync({
          amount_atomic: canonicalGrossAmount,
          recipient: recipient.trim(),
        });
        setPhase({
          kind: "glc-to-sol-deposit",
          requestId: output.request_id,
          depositVaultAddress: output.deposit_vault_address,
          depositBindingHex: output.deposit_binding_hex,
        });
      } else {
        if (!status.data) throw new Error("Bridge status is not loaded");
        const sourceAtomic = BigInt(
          canonicalToSourceRawExact(String(canonicalGrossAmount), sourceToken.decimals),
        );
        const result = await depositToReserve.deposit({
          amountAtomic: sourceAtomic,
          goldcoinAddress: recipient.trim(),
          obligationIndex: status.data.next_solana_obligation_index,
        });
        setPhase({ kind: "sol-to-glc-waiting", signature: result.signature });
        void pollForTransfer(wallet.address);
      }
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function pollForTransfer(address: string | null) {
    if (!address) return;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      try {
        const page = await bridgeApi.listTransfers({ address, limit: 5 });
        const match = page.items.find((item) => item.direction === "SolToGlc");
        if (match) {
          router.push(`/bridge/${match.id}`);
          return;
        }
      } catch {
        // Keep polling silently; the waiting-state copy already tells the
        // user their deposit is on-chain regardless of this poll's outcome.
      }
    }
  }

  if (phase.kind === "glc-to-sol-deposit") {
    return (
      <Card>
        <h2 className="text-heading-2 mb-4">Send your deposit</h2>
        <DepositInstructions
          depositVaultAddress={phase.depositVaultAddress}
          depositBindingHex={phase.depositBindingHex}
        />
        <Button
          className="mt-4"
          fullWidth
          onClick={() => router.push(`/bridge/${phase.requestId}`)}
        >
          I&apos;ve sent it — track this transfer
        </Button>
      </Card>
    );
  }

  if (phase.kind === "sol-to-glc-waiting") {
    return (
      <Card>
        <h2 className="text-heading-2 mb-2">Deposit submitted</h2>
        <p className="text-body-sm text-ink-600">
          Your Solana transaction has been submitted (signature{" "}
          {phase.signature.slice(0, 12)}…). Waiting for the bridge to observe it — this
          page will move on automatically once it does.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-heading-2 mb-4">Bridge GLC</h2>

      <div className="flex flex-col gap-5">
        <DirectionSelector
          value={direction}
          onChange={(next) => {
            setDirection(next);
            setAmountInput("");
            setRecipient("");
          }}
        />

        <div>
          <label htmlFor="bridge-amount" className="text-body-sm text-ink-600 mb-1 block">
            Amount ({sourceToken.symbol})
          </label>
          <input
            id="bridge-amount"
            aria-label={`Amount in ${sourceToken.symbol}`}
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => setAmountInput(event.target.value)}
            placeholder="0.00"
            className="border-ink-200 text-heading-3 tabular w-full rounded-lg border px-3 py-2"
          />
          {amountValidation && isReportableProblem(amountValidation.problem) && (
            <p className="text-body-sm text-danger-700 mt-1">
              {amountValidation.message}
            </p>
          )}
          {amountBounds && (
            <p className="text-body-sm text-ink-500 mt-1">
              Min{" "}
              {display(amountBounds.minimum, amountBounds.decimals, amountBounds.symbol)}{" "}
              · Max{" "}
              {display(amountBounds.maximum, amountBounds.decimals, amountBounds.symbol)}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="bridge-recipient"
            className="text-body-sm text-ink-600 mb-1 block"
          >
            {direction === "GlcToSol"
              ? "Solana recipient address"
              : "Goldcoin destination address"}
          </label>
          <input
            id="bridge-recipient"
            aria-label={
              direction === "GlcToSol"
                ? "Solana recipient address"
                : "Goldcoin destination address"
            }
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={direction === "GlcToSol" ? "Solana address" : "Goldcoin address"}
            className="border-ink-200 text-mono-sm w-full rounded-lg border px-3 py-2"
          />
          {direction === "GlcToSol" && wallet.address && recipient.trim() === "" && (
            <button
              type="button"
              onClick={() => setRecipient(wallet.address ?? "")}
              className="text-body-sm text-ink-700 mt-1 underline underline-offset-2"
            >
              Use connected wallet ({wallet.address.slice(0, 4)}…
              {wallet.address.slice(-4)})
            </button>
          )}
          {recipient.trim() !== "" &&
            !recipientValidation.valid &&
            recipientValidation.message && (
              <p className="text-body-sm text-danger-700 mt-1">
                {recipientValidation.message}
              </p>
            )}
        </div>

        {direction === "SolToGlc" && <ExchangeAddressWarning />}

        {canonicalGrossAmount > 0 && <QuoteBreakdown quote={quote} />}

        {submitError ? <ErrorState error={submitError} /> : null}

        {!gate.can && gate.reason && <Alert level="info" title={gate.reason} />}

        <Button
          fullWidth
          size="lg"
          loading={submitting}
          onClick={() => void submit()}
          {...(!gate.can
            ? { disabled: true, disabledReason: gate.reason ?? "Cannot submit yet." }
            : {})}
        >
          {direction === "GlcToSol" ? "Create deposit request" : "Deposit from wallet"}
        </Button>
      </div>
    </Card>
  );
}

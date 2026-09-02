"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ErrorState,
  TokenAmount,
} from "@/components/ui";
import {
  directionGateState,
  directions,
  display,
  goldcoinAddressRules,
  isReportableAddressProblem,
  isReportableProblem,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  rollingVolumeRemaining,
  SOLANA_GLC,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
  validateAmount,
  validateGoldcoinAddress,
} from "@/lib/bridge";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { routes } from "@/lib/config/links";
import {
  atomicRescaleCeil,
  atomicRescaleFloor,
  canonicalToSourceRawExact,
  minimumGrossCanonicalForMinTransferAmount,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";
import {
  useBridgeStatus,
  useCreateTransfer,
  useLimits,
  useQuote,
  useReserve,
  useSolToGlcRecipientEligibility,
  useChains,
} from "@/lib/query/hooks";
import { isValidAddress, useDepositToReserve, useWalletConnection } from "@/lib/solana";
import {
  bridgeApi,
  recipientRateLimitedError,
  sourceWalletRateLimitedError,
} from "@/lib/api";
import type { Route } from "@/lib/api/schemas/common";
import {
  closedRouteBody,
  closedRouteTitle,
  findRouteView,
  routeAvailable,
  routeDirection,
  settlementLegFor,
} from "@/lib/bridge/direction-state";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import { DirectionSelector } from "./DirectionSelector";
import { QuoteBreakdown } from "./QuoteBreakdown";
import { DepositInstructions } from "./DepositInstructions";
import { ExchangeAddressWarning } from "./ExchangeAddressWarning";

type Phase =
  | { kind: "form" }
  | {
      kind: "glc-to-sol-deposit";
      requestId: number;
      depositAddress: string;
      amountAtomic: string;
    }
  | { kind: "sol-to-glc-waiting"; signature: string };

export function BridgeCard() {
  const router = useRouter();
  const wallet = useWalletConnection();

  // Named `direction` for continuity with the rest of this component, but
  // typed as `Route`: the selector can hold a route that has no settlement
  // direction at all. `settledDirection` below is the narrowed value, and
  // it is `null` exactly when this route cannot produce a transfer.
  const [direction, setDirection] = useState<Route>("GlcToSol");
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const descriptor = directions[direction];
  const sourceToken = descriptor.from.token;

  const chains = useChains();
  const routeView = findRouteView(chains.data?.routes, direction);
  // `routeAvailable` distinguishes "the server closed this route" from "we
  // could not ask": an explicit `enabled: false` closes the route, while a
  // missing entry — /chains unreachable, errored, or carrying a route this
  // build does not understand — falls back to the route's own structural
  // default. So a /chains outage no longer disables the live GLC<->SOL
  // routes, while Robinhood stays closed in every case.
  const routeIsOpen = routeAvailable(chains.data, direction);
  const settledDirection = routeDirection(direction);

  const status = useBridgeStatus();
  const limits = useLimits();
  const reserve = useReserve();
  const createTransfer = useCreateTransfer();
  const depositToReserve = useDepositToReserve();

  const amountBounds = useMemo(() => {
    if (!limits.data) return null;
    // A token whose decimals are not yet known (Robinhood) gets no bounds
    // rather than a guessed scale — every figure derived below would
    // otherwise be silently wrong by orders of magnitude.
    if (sourceToken.decimals === null) return null;
    const sourceDecimals = sourceToken.decimals;
    // The minimum is a GROSS-side product floor, DERIVED from `/limits`'
    // own `min_transfer_amount` and `bridge_fee_bps` — never `/limits`'
    // `min_transfer_amount` used directly, since that figure is a
    // NET-side on-chain check (`limits.rs::enforce_transfer_amount`), and
    // displaying/enforcing it as if it were the minimum a user enters
    // understates the true floor by exactly the bridge fee (this was the
    // "Min 99 GLC" bug). Computed, not hardcoded, so it never goes stale
    // again the way a fixed constant did when the real fee moved from 1%
    // to 6% (later 3%) — see `minimumGrossCanonicalForMinTransferAmount`.
    const minimumCanonical = minimumGrossCanonicalForMinTransferAmount(
      String(limits.data.min_transfer_amount),
      limits.data.bridge_fee_bps,
      SOLANA_GLC.decimals,
    );
    // Ceil when narrowing to this direction's own source decimals — same
    // "never more permissive than the backend's" convention `atomicRescaleCeil`
    // documents; a no-op at 8 decimals (Goldcoin, already canonical).
    const minimum = atomicRescaleCeil(
      minimumCanonical,
      GOLDCOIN_DECIMALS,
      sourceDecimals,
    );
    // `/limits` passes the on-chain `BridgeConfig` value through raw, and
    // the on-chain check compares it against MINT-atomic amounts (6
    // decimals) — so this one IS in mint units, not the canonical
    // 8-decimal unit quotes use. Floor it so the client-side bound is
    // never more permissive than the on-chain one.
    const maximum = atomicRescaleFloor(
      String(limits.data.per_transfer_limit),
      SOLANA_GLC.decimals,
      sourceDecimals,
    );
    return {
      decimals: sourceDecimals,
      symbol: sourceToken.symbol,
      minimum,
      maximum,
    };
  }, [limits.data, sourceToken]);

  const amountValidation = amountBounds
    ? validateAmount(amountInput, amountBounds)
    : null;
  const canonicalGrossAmount =
    amountValidation?.raw !== null &&
    amountValidation?.raw !== undefined &&
    sourceToken.decimals !== null
      ? Number(sourceRawToCanonical(amountValidation.raw, sourceToken.decimals))
      : 0;

  // `settledDirection` is null for a route with no settlement machinery, and
  // `useQuote` disables itself on null — so a disabled route never fetches a
  // quote and never renders one.
  const quote = useQuote(settledDirection, canonicalGrossAmount);

  const recipientValidation = useMemo(() => {
    // Keyed off the SETTLED direction: a route with none has no recipient
    // format to validate against, so it is never "valid".
    if (settledDirection === null) return { valid: false, message: null };
    if (settledDirection === "GlcToSol") {
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
  }, [settledDirection, recipient]);

  // The FORM-level dual rate-limit check: fires once a syntactically valid
  // Goldcoin address is entered for SolToGlc, so the user learns "this
  // address already got a payout" or "this wallet already used the
  // bridge" in the last 24 hours before ever reaching for their wallet.
  // The connected wallet's pubkey joins the check automatically as soon
  // as it is available — before that, only the recipient leg is checked,
  // same as before this dual limit existed. `submit()` re-fetches the
  // same answer fresh immediately before invoking the wallet — this
  // hook's cached verdict is never what authorizes opening Phantom.
  const recipientEligibility = useSolToGlcRecipientEligibility(
    recipient.trim(),
    direction === "SolToGlc" ? wallet.address : null,
    direction === "SolToGlc" && recipientValidation.valid,
  );

  // `destinationReserve` is `null` for a route with no reserve. The old
  // ternary sent that case to the Goldcoin branch, so a Robinhood route
  // silently adopted Goldcoin's capacity as its own and passed (or failed) a
  // liquidity check on another chain's behalf.
  const destinationReserveCapacity =
    reserve.data && descriptor.destinationReserve !== null
      ? descriptor.destinationReserve === "solana"
        ? reserve.data.solana_available_capacity
        : reserve.data.goldcoin_available_capacity
      : null;

  // Why a direction is unavailable comes from the /status booleans, not
  // from any backend message string: the backend deliberately returns one
  // cause-agnostic message for every unavailable cause on submit.
  const dirState = status.data
    ? directionGateState(status.data, direction, chains.data)
    : null;
  const remainingRemaining = status.data
    ? rollingVolumeRemaining(status.data, direction)
    : null;
  const remainingMintRaw =
    remainingRemaining !== null ? String(remainingRemaining) : null;

  const gate = useMemo(() => {
    if (chains.isPending || status.isPending || limits.isPending || reserve.isPending) {
      return {
        can: false,
        reason: "Loading bridge status…",
        reasonShownInline: false,
        blocker: null,
      };
    }
    // Checked before every reserve condition, so no later branch can reach
    // `can: true` for an unavailable route. An explicit server `enabled:
    // false` closes it; an unanswerable /chains falls back to the route's
    // structural default (see `routeAvailable`).
    if (!routeIsOpen) {
      return {
        can: false,
        reason: closedRouteTitle(direction),
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (status.isError) {
      return {
        can: false,
        reason: "Bridge status is unavailable.",
        reasonShownInline: false,
        blocker: "unavailable" as const,
      };
    }
    if (dirState === "quota-paused") {
      return {
        can: false,
        reason: `${QUOTA_PAUSED_TITLE} ${QUOTA_PAUSED_BODY}`,
        reasonShownInline: false,
        blocker: "quota-paused" as const,
      };
    }
    if (dirState === "quota-exhausted") {
      return {
        can: false,
        reason: `${QUOTA_EXHAUSTED_TITLE} ${QUOTA_EXHAUSTED_BODY}`,
        reasonShownInline: false,
        blocker: "quota-exhausted" as const,
      };
    }
    if (dirState === "operator-paused") {
      return {
        can: false,
        reason: `${descriptor.label} is currently paused.`,
        reasonShownInline: false,
        blocker: "paused" as const,
      };
    }
    if (
      dirState === "capacity-constrained" ||
      (destinationReserveCapacity !== null && destinationReserveCapacity <= 0)
    ) {
      return {
        can: false,
        reason: "Insufficient reserve liquidity for this direction right now.",
        reasonShownInline: false,
        blocker: "insufficient-liquidity" as const,
      };
    }
    if (!amountValidation || amountValidation.raw === null) {
      const reportable = isReportableProblem(amountValidation?.problem ?? null);
      return {
        can: false,
        reason: reportable ? amountValidation!.message! : "Enter an amount.",
        // The amount field already prints this message inline when reportable.
        reasonShownInline: reportable,
        blocker: null,
      };
    }
    if (remainingMintRaw !== null && sourceToken.decimals !== null) {
      const sourceDecimals = sourceToken.decimals;
      // Mirror of the backend's proactive quota check on POST /transfers:
      // compare the requested amount against this direction's remaining
      // 24h window, in the canonical unit so no precision is lost. The
      // amount is never silently altered — the submit is blocked with the
      // remaining figure stated.
      const remainingCanonical = BigInt(
        sourceRawToCanonical(remainingMintRaw, SOLANA_GLC.decimals),
      );
      const grossCanonical = BigInt(
        sourceRawToCanonical(amountValidation.raw, sourceDecimals),
      );
      if (grossCanonical > remainingCanonical) {
        const remainingDisplay = display(
          atomicRescaleFloor(remainingMintRaw, SOLANA_GLC.decimals, sourceDecimals),
          sourceDecimals,
          sourceToken.symbol,
        );
        return {
          can: false,
          reason: `That amount exceeds the remaining 24-hour bridge capacity for this direction (${remainingDisplay} remaining). Enter a smaller amount, or check back after capacity is replenished.`,
          reasonShownInline: false,
          blocker: null,
        };
      }
    }
    if (!recipientValidation.valid) {
      const reportable = recipient.trim() !== "" && recipientValidation.message !== null;
      return {
        can: false,
        reason: recipientValidation.message ?? "Enter a destination address.",
        // The recipient field already prints this message inline when reportable.
        reasonShownInline: reportable,
        blocker: null,
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
          reasonShownInline: false,
          blocker: null,
        };
      if (recipientEligibility.isPending) {
        return {
          can: false,
          reason: "Checking this address's recent bridge activity…",
          reasonShownInline: false,
          blocker: null,
        };
      }
      if (recipientEligibility.data && !recipientEligibility.data.eligible) {
        // Wallet-first: if the connected wallet itself is rate-limited,
        // that is the ONLY message shown, even if the recipient is also
        // rate-limited — matching the backend's own precedence
        // (`RecipientEligibility::blocked_reason`). Both limits are
        // independently enforced at admission regardless of which one is
        // surfaced here.
        if (recipientEligibility.data.blocked_reason === "source_wallet_rate_limited") {
          return {
            can: false,
            reason: SOURCE_WALLET_RATE_LIMIT_TITLE,
            reasonShownInline: false,
            blocker: "source-wallet-rate-limited" as const,
          };
        }
        return {
          can: false,
          reason: RECIPIENT_RATE_LIMIT_TITLE,
          reasonShownInline: false,
          blocker: "recipient-rate-limited" as const,
        };
      }
      // A FAILED eligibility read (recipientEligibility.isError)
      // deliberately does not block the form: the backend re-checks the
      // same rule authoritatively at admission either way, and submit()
      // makes one more fresh attempt right before the wallet opens — a
      // transient API blip should not brick the whole direction.
    }
    if (quote.isPending) {
      return {
        can: false,
        reason: "Fetching quote…",
        reasonShownInline: false,
        blocker: null,
      };
    }
    if (quote.isError) {
      return {
        can: false,
        reason: "Could not fetch a quote for this amount.",
        reasonShownInline: false,
        blocker: null,
      };
    }
    return { can: true, reason: null, reasonShownInline: false, blocker: null };
  }, [
    chains.isPending,
    routeIsOpen,
    status.isPending,
    status.isError,
    limits.isPending,
    reserve.isPending,
    dirState,
    remainingMintRaw,
    destinationReserveCapacity,
    amountValidation,
    recipientValidation,
    direction,
    recipient,
    depositToReserve,
    recipientEligibility.isPending,
    recipientEligibility.data,
    quote.isPending,
    quote.isError,
    descriptor.label,
    sourceToken,
  ]);

  async function submit() {
    if (!gate.can || !amountValidation?.raw) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // EXHAUSTIVE dispatch on the SETTLED DIRECTION, never on the route.
      //
      // This used to be `if (direction === "GlcToSol") … else …` on a value
      // that is now four-valued, so a Robinhood route fell through to the
      // `else` — the SolToGlc branch, which signs and broadcasts a real
      // `deposit_to_reserve` with the user's Solana wallet. That leg never
      // touches the HTTP API, so unlike every other path there is no
      // backend 409 behind it: a fall-through would move funds on a chain
      // the user did not select, with nothing able to refuse it.
      //
      // `settlementLegFor` is the single, unit-tested source of truth for
      // this decision, and holds the `never` exhaustiveness check (see its
      // docs). `null` means the route has no settlement machinery and must
      // never reach either branch — the same firewall the backend enforces
      // with `Route::as_direction() -> Option<Direction>`.
      const leg = settlementLegFor(direction);
      if (leg === null) {
        throw new Error(
          "This route has no settlement direction and cannot be submitted.",
        );
      }
      // Exhaustive on SettlementLeg, not just on Direction. `settlementLegFor`
      // already makes a new `Direction` variant a compile error; this makes a
      // new *leg* one too. Without it, adding e.g. "robinhood-deposit" would
      // silently fall into the Solana wallet branch — the same shape of bug
      // this block exists to prevent, one level up.
      if (leg === "backend-create") {
        const output = await createTransfer.mutateAsync({
          amount_atomic: canonicalGrossAmount,
          recipient: recipient.trim(),
        });
        setPhase({
          kind: "glc-to-sol-deposit",
          requestId: output.request_id,
          depositAddress: output.deposit_address,
          // GOLDCOIN_GLC has zero canonical padding, so this is the exact
          // amount_atomic just sent to the API, as a base-unit string —
          // never re-derived from the `number` above, which exists only
          // for the wire request field.
          amountAtomic: amountValidation.raw,
        });
      } else if (leg === "wallet-deposit") {
        if (!status.data) throw new Error("Bridge status is not loaded");
        // FINAL pre-submit dual rate-limit re-check, fetched fresh through
        // the client (never the form hook's cache): the address may have
        // received a payout, or this wallet may have made a deposit,
        // between being typed/connected and this click — another tab,
        // another user, a deposit that just finalized. This is exactly
        // what closes the race a slower form-level poll could otherwise
        // miss. A blocked verdict here stops everything BEFORE the wallet
        // is invoked: no Phantom prompt, no Solana obligation, no funds
        // moved. A read that FAILS is a different case and does not stop
        // the submit — the backend re-checks both rules authoritatively at
        // admission, and a deposit admitted while actually rate-limited is
        // parked and auto-resumed once the window clears
        // (glc-solana-reserve-bridge docs/09-runbook.md), so failing open
        // here degrades to a slower transfer, never a lost one.
        let finalEligibility: RecipientEligibilityDto | null = null;
        try {
          finalEligibility = await bridgeApi.getSolToGlcRecipientEligibility(
            recipient.trim(),
            wallet.address,
          );
        } catch {
          finalEligibility = null;
        }
        if (finalEligibility && !finalEligibility.eligible) {
          // Refresh the form-level hook too, so the same verdict also
          // surfaces as the persistent blocker callout + disabled button,
          // not only as this one submit error.
          void recipientEligibility.refetch();
          throw finalEligibility.blocked_reason === "source_wallet_rate_limited"
            ? sourceWalletRateLimitedError()
            : recipientRateLimitedError();
        }
        if (sourceToken.decimals === null) {
          // Unreachable for the two live routes; a hard stop rather than a
          // fallback, because a guessed scale here would build a
          // wrong-by-orders-of-magnitude on-chain transfer.
          throw new Error("This route's token decimals are not known.");
        }
        const sourceAtomic = BigInt(
          canonicalToSourceRawExact(String(canonicalGrossAmount), sourceToken.decimals),
        );
        // `GET /transfers` has no way to ask for "the request this exact
        // deposit created" — SolToGlc requests carry no source_txid (see
        // pollForTransfer's docs) — so the highest request id that already
        // exists for this wallet, captured BEFORE the wallet even signs, is
        // the strongest available correlator: whatever request this deposit
        // creates is guaranteed to land with an id greater than every id
        // captured here, regardless of what else is in the list or how it's
        // ordered. A failure here must not abort the deposit itself (the
        // wallet transaction is independent of this read), so it falls back
        // to `null`, which `pollForTransfer` treats as "cannot correlate."
        const baselineRequestId = await highestKnownRequestId(wallet.address).catch(
          () => null,
        );
        const result = await depositToReserve.deposit({
          amountAtomic: sourceAtomic,
          goldcoinAddress: recipient.trim(),
          obligationIndex: status.data.next_solana_obligation_index,
        });
        setPhase({ kind: "sol-to-glc-waiting", signature: result.signature });
        void pollForTransfer(wallet.address, baselineRequestId);
      } else {
        const unreachable: never = leg;
        throw new Error(`Unsupported settlement leg: ${String(unreachable)}`);
      }
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  /** The highest `bridge_requests.id` this wallet already has, across both
   * directions (ids are a single shared auto-increment sequence — see
   * `service/src/ledger/schema.rs` in glc-solana-reserve-bridge), or `0` if
   * the wallet has no transfers yet — every real id is positive, so `0`
   * still correctly matches "any id that appears is unambiguously new."
   * `null` is reserved for "this read itself failed," a DIFFERENT case
   * `pollForTransfer` must not treat the same way (there, no id is safe to
   * trust as a floor, so it must not guess at all). */
  async function highestKnownRequestId(address: string | null): Promise<number | null> {
    if (!address) return null;
    const page = await bridgeApi.listTransfers({ address, limit: 1 });
    return page.items[0]?.id ?? 0;
  }

  /**
   * Finds the bridge request this specific deposit created and redirects to
   * it.
   *
   * The backend has no field correlating a SolToGlc request to the wallet
   * transaction that created it (`source_txid` is only ever populated for
   * GlcToSol — a SolToGlc request folds from an on-chain obligation INDEX,
   * not a stored transaction id; see `fold_sol_deposit` in
   * glc-solana-reserve-bridge). So this must NOT just take the first
   * `SolToGlc` item in the list: if the wallet has any older SolToGlc
   * request (in any state — completed, abandoned, anything), that item is
   * already in the very first poll response and would be matched
   * immediately, before the new one has even been indexed yet — the exact
   * wrong-request bug this replaces. Requiring `id > baselineRequestId`
   * (captured before submission) rules out every request that could
   * possibly have existed before this one.
   *
   * If `baselineRequestId` could not be established (the pre-submission
   * read failed) or polling times out without a qualifying match, this
   * deliberately does NOT guess — it sends the user to their own
   * wallet-scoped activity list instead, where the new transfer will show
   * up once it's indexed, rather than risking a redirect to someone else's
   * or an old request.
   */
  async function pollForTransfer(
    address: string | null,
    baselineRequestId: number | null,
  ) {
    if (!address) return;
    if (baselineRequestId !== null) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        try {
          const page = await bridgeApi.listTransfers({ address, limit: 5 });
          const match = page.items.find(
            (item) => item.direction === "SolToGlc" && item.id > baselineRequestId,
          );
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
    router.push(`${routes.activity}?address=${encodeURIComponent(address)}`);
  }

  if (phase.kind === "glc-to-sol-deposit") {
    return (
      <Card variant="raised" padding="lg">
        <h1 className="text-heading-2 mb-4">Send your deposit</h1>
        <DepositInstructions
          depositAddress={phase.depositAddress}
          amountAtomic={phase.amountAtomic}
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
      <Card variant="raised" padding="lg">
        <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
        <p className="text-body-sm text-ink-600">
          Your Solana transaction has been submitted (signature{" "}
          {phase.signature.slice(0, 12)}…). Waiting for the bridge to observe it — this
          page will move on automatically once it does.
        </p>
      </Card>
    );
  }

  const destinationToken = descriptor.to.token;

  // Recipient-field copy, derived from the SETTLED direction rather than a
  // two-way ternary on a four-valued route. The old
  // `direction === "GlcToSol" ? … : …` described every unbuilt route as a
  // Goldcoin destination, and labelled its submit button "Deposit from
  // wallet" — the precise wrong mental model for a route that settles
  // nowhere.
  const recipientCopy =
    settledDirection === "GlcToSol"
      ? { label: "Solana recipient address", placeholder: "Solana address" }
      : settledDirection === "SolToGlc"
        ? { label: "Goldcoin destination address", placeholder: "Goldcoin address" }
        : { label: "Destination address", placeholder: "Destination address" };
  const submitLabel =
    settledDirection === "GlcToSol"
      ? "Create deposit request"
      : settledDirection === "SolToGlc"
        ? "Deposit from wallet"
        : "Unavailable";

  const onRouteChange = (next: Route) => {
    setDirection(next);
    setAmountInput("");
    setRecipient("");
    setSubmitError(null);
  };

  // An unavailable route renders the selector and a plain statement, and
  // NOTHING else: no amount field, no recipient field, no quote panel, no
  // capacity figure, no submit control — the submit button is absent from
  // the tree rather than present-and-disabled, so there is no element to
  // re-enable from devtools. The quote and eligibility queries are already
  // inert for this route (see `useQuote` above), so no request is issued
  // for it either.
  //
  // Nothing here is fabricated: no balance, no fee, no rate, no status.
  // The title is derived from the route, so a live route the server has
  // closed is never explained with Robinhood wording.
  if (!routeIsOpen) {
    return (
      <Card variant="raised" padding="lg">
        <div className="mb-5">
          <h1 className="text-heading-2">Bridge GLC</h1>
          <p className="text-body-sm text-ink-500 mt-1">
            Reserve-backed, 1:1. Nothing is minted, burned, or wrapped.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <DirectionSelector
            value={direction}
            onChange={onRouteChange}
            chains={chains.data}
          />
          <Alert level="info" title={closedRouteTitle(direction)}>
            <p>{routeView?.disabled_reason ?? closedRouteBody(direction)}</p>
          </Alert>
        </div>
      </Card>
    );
  }

  return (
    <Card variant="raised" padding="lg">
      <div className="mb-5">
        <h1 className="text-heading-2">Bridge GLC</h1>
        <p className="text-body-sm text-ink-500 mt-1">
          Reserve-backed, 1:1. Nothing is minted, burned, or wrapped.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <DirectionSelector
            value={direction}
            onChange={onRouteChange}
            chains={chains.data}
          />
          {destinationReserveCapacity !== null &&
            destinationReserveCapacity > 0 &&
            destinationToken.decimals !== null && (
              <p className="text-body-sm text-ink-500 mt-2">
                Available capacity:{" "}
                <TokenAmount
                  raw={String(destinationReserveCapacity)}
                  decimals={destinationToken.decimals}
                  symbol={destinationToken.symbol}
                  className="text-ink-700"
                />
              </p>
            )}
        </div>

        {gate.blocker && (
          <BlockerAlert blocker={gate.blocker} directionLabel={descriptor.label} />
        )}

        <div>
          <label htmlFor="bridge-amount" className="text-body-sm text-ink-600 mb-1 block">
            You bridge
          </label>
          <div className="border-ink-200 focus-within:border-ink-400 flex items-center rounded-lg border pr-3 transition-colors">
            <input
              id="bridge-amount"
              aria-label={`Amount in ${sourceToken.symbol}`}
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              placeholder="0.00"
              className="text-heading-2 tabular min-w-0 flex-1 rounded-lg px-3 py-2.5 outline-none"
            />
            <span className="text-body text-ink-500 font-medium">
              {sourceToken.symbol}
            </span>
          </div>
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
              {remainingMintRaw !== null && (
                <span title="Remaining 24-hour bridge capacity for this direction. Reopening after exhaustion is a manual operator action, not automatic.">
                  {" "}
                  ·{" "}
                  {display(
                    atomicRescaleFloor(
                      remainingMintRaw,
                      SOLANA_GLC.decimals,
                      amountBounds.decimals,
                    ),
                    amountBounds.decimals,
                    amountBounds.symbol,
                  )}{" "}
                  remaining today
                </span>
              )}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="bridge-recipient"
            className="text-body-sm text-ink-600 mb-1 block"
          >
            {recipientCopy.label}
          </label>
          <div className="border-ink-200 focus-within:border-ink-400 flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors">
            <Wallet aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
            <input
              id="bridge-recipient"
              aria-label={recipientCopy.label}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder={recipientCopy.placeholder}
              className="text-mono-sm min-w-0 flex-1 outline-none"
            />
          </div>
          {settledDirection === "GlcToSol" &&
            wallet.address &&
            recipient.trim() === "" && (
              <button
                type="button"
                onClick={() => setRecipient(wallet.address ?? "")}
                className="bg-ink-50 text-ink-700 hover:bg-ink-100 text-body-sm mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1 transition-colors"
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

        <Button
          fullWidth
          size="lg"
          variant="primary"
          loading={submitting}
          onClick={() => void submit()}
          {...(!gate.can
            ? {
                disabled: true,
                disabledReason: gate.reason ?? "Cannot submit yet.",
                // A blocker already gets its own Alert above the form, so the
                // button doesn't repeat the same sentence a second time —
                // the reason still reaches assistive tech via "accessible".
                reasonPlacement:
                  gate.reasonShownInline || gate.blocker ? "accessible" : "inline",
              }
            : {})}
        >
          {submitLabel}
        </Button>
      </div>
    </Card>
  );
}

type Blocker =
  | "unavailable"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused"
  | "recipient-rate-limited"
  | "source-wallet-rate-limited";

/**
 * Bridge-wide, backend-driven blockers get their own callout rather than
 * disappearing into the submit button's disabled-reason text — these are
 * conditions the amount/recipient fields cannot fix, so a reader should
 * see them before filling anything in, not discover them only after
 * clicking a dead-looking button.
 */
function BlockerAlert({
  blocker,
  directionLabel,
}: {
  blocker: Blocker;
  directionLabel: string;
}) {
  const copy: Record<Blocker, { title: string; funds: string }> = {
    unavailable: {
      title: "We could not reach the bridge status service.",
      funds:
        "No funds have moved. This is a problem loading information, not a problem with a transfer.",
    },
    paused: {
      title: `${directionLabel} is currently paused.`,
      funds:
        "Nothing you enter below will submit while this direction is paused — no funds move.",
    },
    "insufficient-liquidity": {
      title: "This direction has no reserve capacity available right now.",
      funds:
        "Nothing you enter below will submit until capacity is available — no funds move.",
    },
    // The two quota states carry the approved copy verbatim. Neither may
    // ever promise a reset time or an automatic reopening: the backend's
    // pause after exhaustion only clears by manual operator action
    // (docs/09-runbook.md, 2026-08-22).
    "quota-exhausted": {
      title: QUOTA_EXHAUSTED_TITLE,
      funds: `${QUOTA_EXHAUSTED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    "quota-paused": {
      title: QUOTA_PAUSED_TITLE,
      funds: `${QUOTA_PAUSED_BODY} Nothing you enter below will submit — no funds move.`,
    },
    // Unlike every blocker above, this one is specific to the ADDRESS the
    // user typed, not to the bridge or the direction. Per the product
    // decision in `@/lib/bridge/recipient-rate-limit`, it shows exactly
    // one sentence: empty `funds`/`next` render nothing, and the
    // status-page link (which would show a perfectly healthy bridge) is
    // omitted too. The retry-after time the backend still returns is
    // deliberately not displayed.
    "recipient-rate-limited": {
      title: RECIPIENT_RATE_LIMIT_TITLE,
      funds: "",
    },
    // The source-wallet twin of the above — specific to the CONNECTED
    // WALLET, not the address typed. Same one-sentence product decision
    // (`@/lib/bridge/source-wallet-rate-limit`): no funds/next, no
    // status-page link, no retry-after time shown.
    "source-wallet-rate-limited": {
      title: SOURCE_WALLET_RATE_LIMIT_TITLE,
      funds: "",
    },
  };
  const isRateLimitedBlocker =
    blocker === "recipient-rate-limited" || blocker === "source-wallet-rate-limited";
  const next =
    blocker === "quota-paused"
      ? QUOTA_PAUSED_NEXT
      : blocker === "quota-exhausted"
        ? "See the current status page for live capacity."
        : isRateLimitedBlocker
          ? ""
          : "Check your connection and try again, or see the current status.";

  return (
    <Alert
      level="warn"
      title={copy[blocker].title}
      funds={copy[blocker].funds}
      next={next}
      actions={
        isRateLimitedBlocker ? undefined : (
          <ButtonLink href={routes.status} variant="secondary" size="sm">
            View status
          </ButtonLink>
        )
      }
    />
  );
}

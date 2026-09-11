"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, ErrorState } from "@/components/ui";
import { isSettlementRoute, toBigInt } from "@/lib/api/schemas/common";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type { RecipientEligibilityDto } from "@/lib/api/schemas/eligibility";
import {
  bridgeApi,
  recipientRateLimitedError,
  robinhoodPredepositError,
  sourceWalletRateLimitedError,
} from "@/lib/api";
import {
  adapterFor,
  CHAIN_DESCRIPTORS,
  destinationsFor,
  directionGateState,
  display,
  displayDescriptorFor,
  isCanonicalRobinhoodAmount,
  isDefinedPair,
  isReportableProblem,
  isRouteEffectivelyAvailable,
  isRouteEnabled,
  largestCanonicalRobinhoodAmountAtMost,
  maximumBridgeableAmount,
  CANONICAL_TO_ROBINHOOD_SCALE,
  isRouteExecutableHere,
  perTransferCeiling,
  resolveRoute,
  robinhoodContractLeg,
  routeExecutionSupport,
  robinhoodPerTransferMaximum,
  routesTouchingChain,
  routeSourceMinimum,
  robinhoodRollingRemaining,
  robinhoodPredepositVerdict,
  robinhoodRawToCanonicalExact,
  rollingVolumeRemaining,
  routeAvailability,
  validateAmount,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_TITLE,
  RECIPIENT_RATE_LIMIT_TITLE,
  ROBINHOOD_ELIGIBILITY_UNKNOWN_TITLE,
  ROBINHOOD_RECIPIENT_RATE_LIMIT_TITLE,
  ROBINHOOD_SOURCE_WALLET_RATE_LIMIT_TITLE,
  SOLANA_GLC,
  SOURCE_WALLET_RATE_LIMIT_TITLE,
} from "@/lib/bridge";
import type {
  AmountBounds,
  ChainAdapter,
  RobinhoodContractLeg,
  RobinhoodPredepositVerdict,
  SolanaGovernedRoute,
} from "@/lib/bridge";
import {
  atomicRescaleFloor,
  canonicalToSourceRawExact,
  sourceRawToCanonical,
} from "@/lib/bridge/canonical";
import { formatBaseUnits, formatDisplayDecimalOrRaw } from "@/lib/format/amount";
import { routes } from "@/lib/config/links";
import {
  encodeGoldcoinDestination,
  evmWalletQueryKeys,
  robinhoodDeployment,
  robinhoodDepositCapability,
  useEvmWallet,
  useRobinhoodDeposit,
} from "@/lib/evm";
import {
  useBridgeStatus,
  useChains,
  useCreateTransfer,
  useLimits,
  useQuote,
  useReserve,
  useRhnToGlcRecipientEligibility,
  useRobinhoodLimits,
  useSolToGlcRecipientEligibility,
} from "@/lib/query/hooks";
import { queryKeys } from "@/lib/query/keys";
import { useDepositToReserve, useWalletConnection, walletQueryKeys } from "@/lib/solana";
import { useQueryClient } from "@tanstack/react-query";
import { BlockerAlert, type Blocker } from "./BlockerAlert";
import { DepositInstructions } from "./DepositInstructions";
import { DestinationContext, SourceContext } from "./chain-context";
import { DirectionSwitch } from "./DirectionSwitch";
import { AmountEstimate, AmountInput, NetworkPanel } from "./NetworkPanel";
import { NetworkSelector, type NetworkOption } from "./NetworkSelector";
import { RouteSummary } from "./RouteSummary";
import { SourceBalanceRow } from "./SourceBalanceRow";
import { useSourceBalance } from "./useSourceBalance";

/**
 * The bridge form: pick two networks, enter an amount, send.
 *
 * # Network-first, route-derived
 *
 * A user chooses a SOURCE and a DESTINATION network. The backend route is
 * derived from that pair by `resolveRoute` — one function, one table — and
 * never chosen directly. That is what lets this page scale: a new network
 * is a registry entry plus a backend route mapping, and this file does not
 * change. The previous design put one card per route on the page, which
 * meant every added network multiplied the cards and eventually the
 * layout.
 *
 * A pair that resolves to no route is unusable and says so. It never falls
 * back to a route that does exist.
 *
 * # Where the per-network differences live
 *
 * Not here. Address formats, labels and funding kinds come from the
 * `ChainAdapter` table; the chain-specific JSX lives in `./chain-context`.
 * What remains in this file is the part that is the same for every pair:
 * amount handling, the quote, the gate, and the three funding paths the
 * backend actually offers.
 *
 * # This is a bridge
 *
 * The layout borrows the clarity of a swap interface, and none of its
 * meaning. Nothing is exchanged, priced against another asset, or traded:
 * the same GLC is released from a reserve on the destination network. The
 * copy says so and never says otherwise.
 */

type Phase =
  | { kind: "form" }
  | {
      /**
       * Both Goldcoin-SOURCED routes end here: the backend creates the
       * request and returns an address to send Goldcoin to, and nothing
       * about that step differs between a Solana and a Robinhood
       * destination.
       */
      kind: "goldcoin-deposit";
      requestId: number;
      depositAddress: string;
      amountAtomic: string;
    }
  | { kind: "solana-deposit-submitted"; signature: string }
  | { kind: "robinhood-deposit-submitted"; hash: string };

const DEFAULT_SOURCE = "goldcoin";
const DEFAULT_DESTINATION = "solana";

export function BridgeForm() {
  const router = useRouter();
  const wallet = useWalletConnection();

  const [sourceChainId, setSourceChainId] = useState(DEFAULT_SOURCE);
  const [destinationChainId, setDestinationChainId] = useState(DEFAULT_DESTINATION);
  const [amountInput, setAmountInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const status = useBridgeStatus();
  const chains = useChains();
  const limits = useLimits();
  const reserve = useReserve();
  const createTransfer = useCreateTransfer();
  const depositToReserve = useDepositToReserve();
  const evmWallet = useEvmWallet();
  const robinhoodDeposit = useRobinhoodDeposit(evmWallet);
  const queryClient = useQueryClient();

  // Keyed on the SOURCE network, so switching networks reads a different
  // hook's result rather than carrying the previous chain's figure across.
  const sourceBalance = useSourceBalance(sourceChainId, evmWallet);

  const source = displayDescriptorFor(sourceChainId);
  const destination = displayDescriptorFor(destinationChainId);
  const sourceAdapter = adapterFor(sourceChainId);
  const destinationAdapter = adapterFor(destinationChainId);

  // The single derivation of "which backend route is this". Everything
  // below reads `route`; nothing re-derives it.
  const resolution = resolveRoute(sourceChainId, destinationChainId);
  const route = resolution.kind === "route" ? resolution.route : null;
  const availability = routeAvailability(chains.data, route ?? "");

  const sourceToken = source.token;
  const destinationToken = destination.token;
  const sourceIsRobinhood = sourceChainId === "robinhood";

  /**
   * Which published ceiling bounds THIS pair — the one table, shared with
   * /status, so the maximum this form enforces and the one that page prints
   * are the same figure.
   *
   * This used to be an inline `neither side is Robinhood` boolean. That
   * answered correctly while Robinhood only ever paired with Goldcoin, and
   * wrongly on the cross routes, where both chains publish a ceiling:
   * `SolToRhn` is bounded by the Solana program on the way in, and the
   * inline test called that "Robinhood-legged" and dropped the one bound
   * that applies to the deposit. See `./route-limits` for which side wins
   * and why no combined figure is shown.
   */
  const ceiling = perTransferCeiling(sourceChainId, destinationChainId);
  const limitsGovernRoute = ceiling === "solana-program";

  /**
   * The Robinhood custody contract's own ceilings, for the one route this
   * form is currently pointed at.
   *
   * Gated exactly as the status page gates `useRobinhoodReserve`:
   * `isRouteEnabled`, not `isRouteEffectivelyAvailable`. A route an
   * operator has switched on but whose destination reserve has gated it
   * shut this minute still HAS a per-transfer maximum, and that maximum
   * is a true statement about it — the reason it cannot be used right now
   * is carried by the blocker, not by blanking the limit. A deployment
   * without the route never fires the request at all.
   */
  const robinhoodLimits = useRobinhoodLimits(
    // Every route touching the custody contract, not just the Goldcoin
    // pair: the cross routes are bounded and windowed by the same contract
    // and need the same read. Still gated on the pair the form is pointed
    // at, so a Goldcoin↔Solana pair never fires the request.
    routesTouchingChain("robinhood").some(
      (candidate) => route === candidate && isRouteEnabled(chains.data, candidate),
    ),
  );

  /**
   * Which side of the custody contract this pair touches, derived from the
   * two chain ids rather than read off `route`.
   *
   * The one value in this component that does not come from the single
   * route resolution above, and the reason is a compiler one: `route` has
   * already been handed to `routeAvailability` by this point, after which
   * the React Compiler can no longer prove it is unmutated and rejects it
   * — or anything derived from it — as a `useMemo` dependency.
   * `robinhoodContractLeg` states the same mapping and is pinned against
   * `resolveRoute` by test, so the two cannot disagree about which pair
   * is which. It is `null` for a pair with Robinhood on neither side, and
   * non-null for all four that have it on one — including the two cross
   * routes, which the inlined version of this test used to miss.
   */
  const robinhoodLeg: RobinhoodContractLeg | null = robinhoodContractLeg(
    sourceChainId,
    destinationChainId,
  );

  /**
   * This pair's per-transaction ceiling in the source token's own base
   * units — `undefined` on a pair the contract does not bound, and while
   * its limits have not been read.
   */
  const robinhoodMaximum = useMemo(
    () =>
      robinhoodPerTransferMaximum(
        robinhoodLeg,
        robinhoodLimits.data,
        sourceToken.decimals,
      ),
    [robinhoodLeg, robinhoodLimits.data, sourceToken.decimals],
  );

  /**
   * **The source-side minimum for this pair**, in the source token's own
   * base units — the SAME rule on every route, published by the backend.
   *
   * # Why nothing is computed here any more
   *
   * This used to be derived per route from whichever chain floor governed
   * it, grossed up through the fee wherever that floor bounded the NET
   * rather than the gross. The arithmetic was right and the rule was
   * wrong: a chain's net-side floor is not a statement about what a user
   * may type, and deriving one from it produced entry minimums like
   * "102.061856 GLC" that moved every time a fee did.
   *
   * The backend now states the rule directly — one policy floor, the same
   * value `POST /transfers` and `POST /quote` admit against — and this
   * renders it. In particular it is NOT adjusted for the fee: the fee is
   * deducted after the minimum is checked, so a minimum transfer
   * legitimately delivers less than this, and grossing the displayed
   * figure up would publish a floor the backend does not apply.
   *
   * `undefined` when the route is unknown to this response or the backend
   * predates the field — never a fallback figure, which would be this
   * client inventing a limit again.
   */
  // Keyed by the two chain ids rather than the resolved route, for the
  // same compiler reason `robinhoodLeg` above is: `route` has already
  // been handed to `routeAvailability` by this point, after which the
  // React Compiler refuses it — or anything derived from it — as a
  // dependency. `RouteView` carries both chain ids, so nothing is
  // restated to achieve it.
  const sourceMinimum = useMemo(
    () =>
      routeSourceMinimum(
        chains.data,
        sourceChainId,
        destinationChainId,
        sourceToken.decimals,
      ),
    [chains.data, sourceChainId, destinationChainId, sourceToken.decimals],
  );

  /**
   * What the custody contract's rolling 24-hour window has left for this
   * pair, in source units — read from the accumulator the contract
   * charges, never reconstructed here.
   */
  const robinhoodRemaining = useMemo(
    () =>
      robinhoodRollingRemaining(robinhoodLeg, robinhoodLimits.data, sourceToken.decimals),
    [robinhoodLeg, robinhoodLimits.data, sourceToken.decimals],
  );

  const amountBounds = useMemo(() => {
    // The MINIMUM is the same rule on every route and comes from one
    // place — `GET /chains`' per-route `min_transfer_atomic` — so it sits
    // outside the branch below. Only the MAXIMUM differs, because the two
    // chains really do enforce different ceilings: the Solana program's
    // `per_transfer_limit` where `perTransferCeiling` says that bounds the
    // pair, `GlcRobinhoodBridge`'s `inboundMax`/`outboundMax` where it says
    // the contract does.
    if (!limitsGovernRoute) {
      return {
        decimals: sourceToken.decimals,
        symbol: sourceToken.symbol,
        minimum: sourceMinimum,
        maximum: robinhoodMaximum,
      };
    }
    if (!limits.data) return null;
    return {
      decimals: sourceToken.decimals,
      symbol: sourceToken.symbol,
      minimum: sourceMinimum,
      maximum: atomicRescaleFloor(
        String(limits.data.per_transfer_limit),
        SOLANA_GLC.decimals,
        sourceToken.decimals,
      ),
    };
  }, [limits.data, sourceToken, limitsGovernRoute, sourceMinimum, robinhoodMaximum]);

  const amountValidation = amountBounds
    ? validateAmount(amountInput, amountBounds)
    : null;

  const canonicalGrossAmount = useMemo(() => {
    const raw = amountValidation?.raw;
    if (raw === null || raw === undefined) return "0";
    // Robinhood is the one source whose precision EXCEEDS the canonical
    // unit's, so its conversion narrows and can fail. Never floored: the
    // contract rejects a non-canonical amount rather than rounding it,
    // and rounding here would either strand the remainder in the reserve
    // or claim GLC that was never deposited.
    if (sourceIsRobinhood) return robinhoodRawToCanonicalExact(raw) ?? "0";
    return sourceRawToCanonical(raw, sourceToken.decimals);
  }, [amountValidation?.raw, sourceIsRobinhood, sourceToken.decimals]);

  const amountIsCanonical =
    !sourceIsRobinhood ||
    amountValidation?.raw === null ||
    amountValidation?.raw === undefined ||
    isCanonicalRobinhoodAmount(amountValidation.raw);

  /*
   * The route a quote is requested for.
   *
   * Every route the backend names is now quotable — the cross routes have
   * settlement machinery and the pricing path prices them — so the only
   * reason this is not simply `route` is that `route` is `null` for a pair
   * that resolves to none. `isSettlementRoute` is the runtime narrowing
   * that makes that a type-safe fallback rather than a cast; the `enabled`
   * flag beside it is what actually decides whether a request is made, and
   * it is false in exactly the case the fallback value is used.
   *
   * A closed route is still never priced: asking the backend to quote one
   * earns a refusal it already published on `/chains`.
   */
  const settlementRoute: SettlementRoute =
    route !== null && isSettlementRoute(route) ? route : "GlcToSol";
  const quote = useQuote(
    settlementRoute,
    canonicalGrossAmount,
    route !== null && availability.kind === "open",
  );

  const recipientValidation = useMemo(
    () =>
      destinationAdapter
        ? destinationAdapter.validateAddress(recipient)
        : { valid: false, message: null },
    [destinationAdapter, recipient],
  );

  const recipientEligibility = useSolToGlcRecipientEligibility(
    recipient.trim(),
    route === "SolToGlc" ? wallet.address : null,
    route === "SolToGlc" && recipientValidation.valid,
  );

  /**
   * The RhnToGlc pre-deposit checks.
   *
   * # Why this route is gated and the others are not
   *
   * Every other route asks the backend for permission before anything
   * leaves a wallet: the Goldcoin-sourced ones through `POST /transfers`,
   * which can refuse outright. `RhnToGlc` calls the custody contract's
   * `deposit` directly, so there is no preflight to refuse — a deposit
   * that arrives while the Goldcoin reserve is closed, or from a wallet
   * inside its rolling 24-hour window, is not rejected but FOLDED and
   * parked in `ManualReview` with the user's GLC already committed.
   *
   * So the two published signals that could have prevented it are both
   * read here, both fail closed, and both are re-read fresh in `submit`
   * immediately before the wallet is invoked. The backend re-checks
   * everything authoritatively at fold time and remains the enforcement;
   * what it cannot do is give the deposit back.
   *
   * The query is keyed on route, destination AND wallet, so editing
   * either input is a cache MISS rather than a stale "eligible" carried
   * across the edit.
   */
  const routeIsRhnToGlc = route === "RhnToGlc";
  const rhnEligibility = useRhnToGlcRecipientEligibility(
    recipient.trim(),
    routeIsRhnToGlc ? evmWallet.address : null,
    routeIsRhnToGlc && recipientValidation.valid && evmWallet.address !== null,
  );

  /**
   * `/chains` positively answered `available: true` AND the eligibility
   * endpoint positively cleared THESE inputs — or the single reason it
   * did not. `null` for every other route, which keeps its existing gate
   * untouched.
   */
  const rhnPredeposit: RobinhoodPredepositVerdict | null = routeIsRhnToGlc
    ? robinhoodPredepositVerdict({
        routeAvailable: isRouteEffectivelyAvailable(chains.data, "RhnToGlc"),
        unavailableReason:
          availability.kind === "unavailable" ? availability.reason : null,
        eligibility: rhnEligibility.data ?? null,
        address: recipient.trim(),
        wallet: evmWallet.address,
      })
    : null;

  /**
   * `GET /reserve` carries the Goldcoin and Solana reserves only, so a
   * Robinhood destination — `GlcToRhn` or `SolToRhn` — gets `null` here
   * rather than a stand-in.
   *
   * The Robinhood reserve's capacity IS published now, by its own endpoint
   * (`GET /robinhood/reserve`, rendered on /status). It is deliberately not
   * pulled in here: this value feeds the form's liquidity warning, and
   * fetching a second reserve endpoint on every bridge page load — one that
   * 404s on any deployment without the route — to warn about a route whose
   * pre-deposit gate already refuses on `available: false` would buy
   * nothing. Nothing is estimated either way.
   */
  const destinationReserveCapacity =
    reserve.data && destinationChainId !== "robinhood"
      ? destinationChainId === "solana"
        ? reserve.data.solana_available_capacity
        : reserve.data.goldcoin_available_capacity
      : null;

  // `/status`'s availability, quota and rolling-volume fields are named
  // per SOLANA route and derive from a Solana PDA. There is no Robinhood
  // equivalent, and the backend deliberately does not apply the Solana
  // window to a Robinhood payout.
  const solanaGovernedRoute: SolanaGovernedRoute | null =
    route === "GlcToSol" || route === "SolToGlc" ? route : null;
  const dirState =
    status.data && solanaGovernedRoute
      ? directionGateState(status.data, solanaGovernedRoute)
      : null;
  const remainingMintRaw =
    status.data && solanaGovernedRoute
      ? String(rollingVolumeRemaining(status.data, solanaGovernedRoute))
      : null;

  /**
   * The largest amount that could actually be bridged right now.
   *
   * Only bounds that govern THIS route are passed in. `amountBounds`
   * carries a maximum solely for the Solana-governed pairs — `GET /limits`
   * describes the Solana program's reserve — and `remainingMintRaw` is
   * likewise `null` for a Robinhood-legged route, so neither is applied
   * where it would be a ceiling that no chain enforces.
   *
   * The granularity is where the Robinhood custody contract's own rule
   * enters: it reverts any amount that is not an exact multiple of 10^10,
   * so a MAX that ignored it would fill in a number guaranteed to fail.
   */
  const maxAmount = useMemo(() => {
    if (sourceBalance.kind !== "known") return null;
    return maximumBridgeableAmount({
      balanceRaw: sourceBalance.raw,
      routeMaximumRaw: amountBounds?.maximum ?? null,
      remainingCapacityRaw:
        remainingMintRaw === null
          ? null
          : atomicRescaleFloor(
              remainingMintRaw,
              SOLANA_GLC.decimals,
              sourceBalance.decimals,
            ),
      granularity: sourceIsRobinhood ? CANONICAL_TO_ROBINHOOD_SCALE : 1n,
    });
  }, [sourceBalance, amountBounds, remainingMintRaw, sourceIsRobinhood]);

  /**
   * Fills the amount field with the exact MAX, at full precision.
   *
   * Deliberately routed through the ordinary `amountInput` state: the
   * value is then validated, quoted and gated exactly as a typed one is.
   * MAX is a typing shortcut, never a bypass — pressing it on a closed
   * route still cannot submit.
   */
  function applyMax() {
    if (maxAmount === null || sourceBalance.kind !== "known") return;
    setAmountInput(
      formatBaseUnits(maxAmount, sourceBalance.decimals, {
        // Full precision and no separators: this is a form value, not a
        // display string. Rounding it to two places would fill in an
        // amount the user does not hold, or silently drop the dust that
        // makes it exactly bridgeable.
        grouping: false,
        minFractionDigits: 0,
        maxFractionDigits: sourceBalance.decimals,
      }),
    );
    setSubmitError(null);
  }

  /**
   * The rolling-window headroom this pair still has, in the SOURCE
   * token's units, or `null` when this pair publishes none.
   *
   * Exactly one of the two can be non-null for a given pair, because a
   * pair is governed by one chain's window or the other's and never
   * both: `remainingMintRaw` is `null` off the Solana-governed routes,
   * and `robinhoodRemaining` is `undefined` off the Robinhood-legged
   * ones. The Solana figure arrives in the reserve mint's 6 decimals and
   * narrows here; the Robinhood one was narrowed from 18 already, by the
   * helper that knows which window it came from.
   */
  const rollingRemaining: string | null =
    remainingMintRaw !== null
      ? atomicRescaleFloor(remainingMintRaw, SOLANA_GLC.decimals, sourceToken.decimals)
      : (robinhoodRemaining ?? null);

  /**
   * Why the two families word this differently: exhausting the Solana
   * quota AUTO-PAUSES the reserve, and a human has to resume it, so the
   * window filling is not a wait-it-out condition there. The Robinhood
   * contract's bucket is a fixed window `_consumeWindow` resets on its
   * own next write past the boundary, with no operator involved —
   * promising a manual reopening there would be false, and promising an
   * automatic one on Solana would be worse.
   */
  const rollingRemainingHint =
    remainingMintRaw !== null
      ? "Remaining 24-hour bridge capacity for this route. Reopening after exhaustion is a manual operator action, not automatic."
      : "Remaining capacity in this route's rolling 24-hour window, as the bridge contract itself accounts for it. It refills when the window rolls over.";

  // Called directly rather than memoized by hand: it is a pure
  // function of values already computed above, the React Compiler
  // memoizes it, and a hand-written dependency list for this many
  // inputs could only drift from them.
  const gate: Gate = computeGate({
    resolution,
    availability,
    // Whether THIS BUILD can construct the route's source transaction, which
    // is a different question from whether the backend would admit one. See
    // `@/lib/bridge/route-execution`.
    execution: route === null ? null : routeExecutionSupport(route),
    chainsPending: chains.isPending,
    chainsError: chains.isError,
    statusPending: status.isPending,
    statusError: status.isError,
    limitsPending: limits.isPending,
    reservePending: reserve.isPending,
    sourceAdapter,
    destinationAdapter,
    dirState,
    remainingMintRaw,
    destinationReserveCapacity,
    amountValidation,
    amountIsCanonical,
    recipientValid: recipientValidation.valid,
    recipientMessage: recipientValidation.message,
    recipientTouched: recipient.trim() !== "",
    sourceToken,
    routeLabel: `${source.name} → ${destination.name}`,
    solanaCapability: depositToReserve.capability,
    robinhoodCapability: () =>
      robinhoodDepositCapability({
        deployment: robinhoodDeployment(),
        injectedWalletAvailable: evmWallet.hasInjectedWallet,
        walletConnected: evmWallet.address !== null,
        connectedChainId: evmWallet.chainId,
        // Established by the availability check above, which returns
        // before this is ever called for a non-open route.
        routeOpen: true,
        amountIsCanonical,
        destinationValid: recipientValidation.valid,
      }),
    eligibility: {
      applies: route === "SolToGlc",
      pending: recipientEligibility.isPending,
      data: recipientEligibility.data ?? null,
    },
    predeposit: {
      applies: routeIsRhnToGlc,
      // A query that has not answered YET is not a permission: it holds
      // the button rather than releasing it, which is the difference
      // between this gate and its advisory SolToGlc sibling. A background
      // REFETCH of an answer that already arrived is deliberately not
      // "pending" — that would flicker the button off every poll tick,
      // and the answer being refreshed is still the one this form holds.
      // Staleness is closed by the fresh re-read in `submit`, not by
      // disabling the button between polls.
      pending: rhnEligibility.isPending,
      verdict: rhnPredeposit,
    },
    quotePending: quote.isPending,
    quoteError: quote.isError,
    recipientRaw: recipient,
  });

  /** Clears everything that belonged to the previous pair. */
  function selectPair(nextSource: string, nextDestination: string) {
    setSourceChainId(nextSource);
    setDestinationChainId(nextDestination);
    setAmountInput("");
    // The recipient is ALWAYS cleared on a pair change. An address is only
    // meaningful on one network, and carrying a Solana address into a
    // field that now wants a Goldcoin one is the single most expensive
    // thing this form could leave behind — the validator would reject it,
    // but a user who does not re-read the field would not know why.
    setRecipient("");
    setSubmitError(null);
  }

  /**
   * Picking a source keeps the current destination when that still makes a
   * usable pair, and otherwise moves to one that does.
   *
   * "Usable" here means the route has settlement machinery — `/chains`'
   * `implemented` flag, not `enabled`. A CLOSED route is a fine place to
   * land: it is real, it may open, and the form explains it. A route with
   * no machinery at all is not, because nothing will ever happen there, and
   * silently parking someone on one after a single click is a bad first
   * answer to "does this bridge support my network".
   *
   * This reads availability rather than deriving it, and it only chooses
   * which defined pair to show — it never makes a closed route usable.
   */
  /**
   * Picks the destination to land on when the SOURCE selector changes.
   *
   * # Why this is ranked rather than a single predicate
   *
   * It used to keep the current destination whenever that pair was merely
   * `implemented`. That was indistinguishable from "usable" only while
   * every implemented route was also open — and it stopped being true as
   * soon as `SolToRhn`/`RhnToSol` shipped built and switched off. Switching
   * the source to Robinhood while the destination was Solana then landed on
   * `RhnToSol`, a closed route, instead of falling through to `RhnToGlc`,
   * an open one. Being implemented says the settlement machinery exists; it
   * is not permission to move value, and it is not a reason to put a user
   * in front of a route that cannot run.
   *
   * So an OPEN route is preferred over one that merely exists, and the
   * user's own choice is preferred over the registry's order:
   *
   *   1. the destination already selected, if THIS pair is open and
   *      startable from this app
   *   2. the first such destination from this source
   *   3. the destination already selected, if nothing is open and the
   *      verdict is `unknown` — `/chains` has not answered, so moving the
   *      user on a guess would be worse than leaving them where they are
   *   4. the first destination that at least exists and is not
   *      structurally inert, then anything defined at all
   *
   * Nothing here opens a route or changes what the backend reports. The
   * landing pair is still gated by every check that stood in front of it
   * before, and steps 3–4 exist only so a source with no open destination
   * still lands somewhere coherent rather than nowhere.
   */
  function onSourceChange(nextSource: string) {
    const candidates = destinationsFor(nextSource);
    const verdictOf = (destinationId: string) => {
      const resolved = resolveRoute(nextSource, destinationId);
      if (resolved.kind !== "route") return null;
      return routeAvailability(chains.data, resolved.route).kind;
    };
    // "Open" here means open AND startable from this app. A route the
    // backend serves but this build cannot construct a deposit for is a
    // worse landing place than a closed one: the user would arrive on a
    // pair that looks available everywhere else in the UI and cannot be
    // submitted. It stays selectable — a user may still want to read about
    // it — but a single click on the source selector never parks anyone
    // there when something startable exists.
    const isOpen = (destinationId: string) => {
      const resolved = resolveRoute(nextSource, destinationId);
      return (
        verdictOf(destinationId) === "open" &&
        resolved.kind === "route" &&
        isRouteExecutableHere(resolved.route)
      );
    };
    // Everything the selector may land on at all. `unimplemented` is the
    // only verdict excluded: a route with no machinery behind it cannot
    // become usable, so it is never a destination to fall back to.
    const exists = (destinationId: string) => {
      const kind = verdictOf(destinationId);
      return kind !== null && kind !== "unimplemented";
    };

    const current = destinationChainId;
    const next =
      (isOpen(current) ? current : undefined) ??
      candidates.find(isOpen) ??
      (verdictOf(current) === "unknown" ? current : undefined) ??
      candidates.find(exists) ??
      candidates[0] ??
      current;
    selectPair(nextSource, next);
  }

  const reverseDefined = isDefinedPair(destinationChainId, sourceChainId);

  return phase.kind !== "form" ? (
    <SubmittedPhase phase={phase} router={router} />
  ) : (
    // A flat 20px rather than `md`'s 16/24 step: at a 510px measure the
    // desktop half of that step was the card's largest single band of
    // empty space, and the panels are the better place to spend it.
    <Card variant="raised" padding="none" className="p-4 md:p-5">
      <div className="mb-2">
        <h1 className="text-heading-2">Bridge GLC</h1>
        <p className="text-body-sm text-ink-500 mt-1">
          Reserve-backed, 1:1. Nothing is minted, burned, or wrapped.
        </p>
      </div>

      {/* Its own landmark: the FROM panel carries the source network's own
          connect buttons, and both tests and assistive tech need to address
          THIS form's primary action without ambiguity. */}
      <section aria-label="Bridge transfer" className="flex flex-col gap-2">
        <NetworkPanel
          label="From"
          selector={
            <NetworkSelector
              label="Source network"
              value={source}
              options={sourceOptions(chains.data, sourceChainId)}
              onChange={onSourceChange}
            />
          }
          amount={
            <AmountInput
              id="bridge-amount"
              ariaLabel={`Amount in ${sourceToken.symbol}`}
              value={amountInput}
              onChange={setAmountInput}
              symbol={sourceToken.symbol}
            />
          }
          meta={
            // Every line under the amount row shares one gap, so the
            // limits, the balance and a validation message cannot space
            // themselves differently from one another.
            <div className="flex flex-col gap-1">
              {amountValidation && isReportableProblem(amountValidation.problem) && (
                <p className="text-body-sm text-danger-700">{amountValidation.message}</p>
              )}
              <SourceBalanceRow
                balance={sourceBalance}
                maxAmount={maxAmount}
                onMax={applyMax}
              />
              {/* Only the bounds this pair actually has, and any of
                  them can be absent while its read is in flight — the
                  previous single `minimum !== undefined` gate hid the
                  whole line in every one of those cases, which is why a
                  Robinhood route once showed no maximum at all. Joined
                  rather than branched in JSX so the separator cannot
                  survive the part beside it going away.

                  Both families now reach the same line by the same route:
                  a server-authoritative floor, ceiling and rolling
                  remainder, each read from the chain that enforces it —
                  the Solana program's `BridgeConfig` and rolling-volume
                  PDA for the Solana pairs, `GlcRobinhoodBridge`'s
                  `limits()` and its inbound/outbound accumulators for the
                  Robinhood ones. Nothing on this line is computed from
                  this UI's own view of activity. */}
              {amountBounds && hasLimitsToShow(amountBounds, rollingRemaining) && (
                <p className="text-body-sm text-ink-500">
                  {boundsSummary(amountBounds)}
                  {rollingRemaining !== null && (
                    <span title={rollingRemainingHint}>
                      {boundsSummary(amountBounds) === null ? "" : " · "}
                      {display(
                        rollingRemaining,
                        amountBounds.decimals,
                        amountBounds.symbol,
                      )}{" "}
                      remaining today
                    </span>
                  )}
                </p>
              )}
            </div>
          }
          context={<SourceContext chainId={sourceChainId} evmWallet={evmWallet} />}
        />

        <DirectionSwitch
          disabled={!reverseDefined}
          disabledReason={
            reverseDefined ? undefined : "This bridge has no route in that direction."
          }
          onSwitch={() => selectPair(destinationChainId, sourceChainId)}
        />

        <NetworkPanel
          label="To"
          selector={
            <NetworkSelector
              label="Destination network"
              value={destination}
              options={destinationOptions(chains.data, sourceChainId)}
              onChange={(next) => selectPair(sourceChainId, next)}
            />
          }
          amount={
            <AmountEstimate
              ariaLabel={`Estimated amount received in ${destinationToken.symbol}`}
              value={
                // Only ever the CURRENT amount's quote — `useQuote` holds
                // no placeholder across key changes, so a failed or
                // in-flight quote shows nothing rather than the figure
                // for an amount the user has already edited away.
                quote.data && !quote.isError
                  ? formatDisplayDecimalOrRaw(quote.data.net_display_amount)
                  : null
              }
              symbol={destinationToken.symbol}
              pending={quote.isPending && toBigInt(canonicalGrossAmount) > 0n}
            />
          }
          meta={
            <div className="flex flex-col gap-1">
              {/* A quote failure is stated in full, through the same
                  three-part error formula as everywhere else. The disabled
                  button's reason alone would leave the user with a dead
                  control and no account of what went wrong. */}
              {quote.isError && (
                <div className="mt-1">
                  <ErrorState error={quote.error} />
                </div>
              )}
              {destinationReserveCapacity !== null &&
                toBigInt(destinationReserveCapacity) > 0n && (
                  <p className="text-body-sm text-ink-500">
                    Available capacity:{" "}
                    {display(
                      destinationReserveCapacity,
                      destinationToken.decimals,
                      destinationToken.symbol,
                    )}
                  </p>
                )}
            </div>
          }
          context={
            destinationAdapter ? (
              <DestinationContext
                adapter={destinationAdapter}
                value={recipient}
                onChange={setRecipient}
                message={recipientValidation.message}
                connectedSolanaAddress={wallet.address}
              />
            ) : null
          }
        />

        {gate.blocker && (
          <BlockerAlert
            blocker={gate.blocker}
            directionLabel={`${source.name} → ${destination.name}`}
            reason={gate.reason ?? ""}
            detail={gate.detail ?? ""}
          />
        )}

        <RouteSummary
          source={source}
          destination={destination}
          availability={availability}
          // Withheld once the quote has failed. The fee and receive rows
          // fall back to "—", which is the truthful answer: the figures
          // this route would settle at are not currently known.
          quote={quote.isError ? undefined : quote.data}
          quotePending={quote.isPending && toBigInt(canonicalGrossAmount) > 0n}
          {...(quote.data && solanaGovernedRoute === "GlcToSol"
            ? { requiredConfirmations: undefined }
            : {})}
        />

        {submitError ? <ErrorState error={submitError} /> : null}

        <Button
          fullWidth
          size="lg"
          variant="primary"
          loading={submitting}
          // `lg`'s type and horizontal padding, one step off its 48px
          // height. 44px is the floor for a touch target, and the form's
          // primary action is the one control that should sit exactly on
          // it rather than above it.
          className="h-11"
          onClick={() => void submit()}
          {...(!gate.can
            ? {
                disabled: true,
                disabledReason: gate.reason ?? "Cannot submit yet.",
                reasonPlacement:
                  gate.reasonShownInline || gate.blocker ? "accessible" : "inline",
              }
            : {})}
        >
          {gate.cta}
        </Button>
      </section>
    </Card>
  );

  async function submit() {
    if (!gate.can || !amountValidation?.raw || !sourceAdapter || !route) return;
    // Defence in depth. The gate already refuses a route this build cannot
    // construct a deposit for, and `gate.can` above is that refusal — but
    // the two arms below encode a specific route in their payload
    // (`CONTRACT_ROUTE_IDS.RhnToGlc`, and a Goldcoin destination for the
    // Solana program), so the one bug that could reach them is worth
    // stopping here rather than trusting a caller. Silent, because the
    // blocker callout has already said it.
    if (!isRouteExecutableHere(route)) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      switch (sourceAdapter.funding) {
        case "goldcoin-deposit-address": {
          // `route` is sent explicitly even where it is the backend's own
          // default: what a request creates is stated by the caller, not
          // inherited from a server-side default that could change.
          const output = await createTransfer.mutateAsync({
            amount_atomic: canonicalGrossAmount,
            recipient: recipient.trim(),
            route: settlementRoute,
          });
          setPhase({
            kind: "goldcoin-deposit",
            requestId: output.request_id,
            depositAddress: output.deposit_address,
            amountAtomic: amountValidation.raw,
          });
          break;
        }
        case "solana-program": {
          if (!status.data) throw new Error("Bridge status is not loaded");
          // FINAL pre-submit dual rate-limit re-check, fetched fresh: the
          // address may have received a payout, or this wallet may have
          // deposited, between being typed and this click. A blocked
          // verdict stops everything BEFORE the wallet is invoked. A read
          // that FAILS does not stop the submit — the backend re-checks
          // authoritatively at admission, so failing open degrades to a
          // slower transfer, never a lost one.
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
            void recipientEligibility.refetch();
            throw finalEligibility.blocked_reason === "source_wallet_rate_limited"
              ? sourceWalletRateLimitedError()
              : recipientRateLimitedError();
          }
          const baselineRequestId = await highestKnownRequestId(wallet.address).catch(
            () => null,
          );
          const result = await depositToReserve.deposit({
            amountAtomic: BigInt(
              canonicalToSourceRawExact(canonicalGrossAmount, sourceToken.decimals),
            ),
            goldcoinAddress: recipient.trim(),
            obligationIndex: status.data.next_solana_obligation_index,
          });
          setPhase({ kind: "solana-deposit-submitted", signature: result.signature });
          refreshSourceBalance();
          void pollForTransfer(wallet.address, baselineRequestId);
          break;
        }
        case "evm-contract": {
          /*
           * FINAL pre-deposit re-check, both halves fetched fresh, and
           * FAIL-CLOSED on every failure.
           *
           * Nothing in the cache authorizes this. A route can close and a
           * rolling window can open between the button enabling and this
           * click — a different tab, another deposit landing, an operator
           * closing admission — and the next thing that happens is an
           * `eth_sendTransaction` whose funds do not come back. So both
           * signals are re-read here, against the values the form holds
           * RIGHT NOW, and any answer that is not an unambiguous yes stops
           * the submit before the wallet is ever opened.
           *
           * This is the opposite disposition to the SolToGlc re-check
           * above, which fails open on a failed read. There, the backend's
           * own admission check is a real floor under a failure. Here it is
           * not: the deposit is already irreversible by the time the
           * backend sees it.
           */
          const destinationAddress = recipient.trim();
          const sourceWallet = evmWallet.address;
          const refuse = (
            verdict: Exclude<RobinhoodPredepositVerdict, { kind: "allowed" }>,
          ): never => {
            // Pull both cached answers back in line with what was just
            // read, so the form's own callout agrees with this refusal
            // rather than still showing an enabled button behind it.
            void queryClient.invalidateQueries({ queryKey: queryKeys.chains() });
            void rhnEligibility.refetch();
            throw robinhoodPredepositError(verdict);
          };
          // A wallet that vanished between render and click. The gate
          // cannot have passed without one, so this is a race, not a
          // state — and it is still not a reason to send anything.
          if (!sourceWallet) refuse({ kind: "eligibility-unknown" });

          let freshChains;
          try {
            freshChains = await bridgeApi.getChains();
          } catch {
            // Unreadable availability is unknown availability.
            freshChains = undefined;
          }
          const freshRoute = routeAvailability(freshChains, "RhnToGlc");
          let freshEligibility: RecipientEligibilityDto | null = null;
          try {
            freshEligibility = await bridgeApi.getRhnToGlcRecipientEligibility(
              destinationAddress,
              sourceWallet,
            );
          } catch {
            freshEligibility = null;
          }
          const verdict = robinhoodPredepositVerdict({
            routeAvailable: isRouteEffectivelyAvailable(freshChains, "RhnToGlc"),
            unavailableReason:
              freshRoute.kind === "unavailable" || freshRoute.kind === "closed"
                ? freshRoute.reason
                : null,
            eligibility: freshEligibility,
            // Checked against the CURRENT form values, not the ones the
            // cached verdict was about: the backend echoes both back
            // precisely so an answer to a superseded question can be
            // discarded rather than acted on.
            address: destinationAddress,
            wallet: sourceWallet,
          });
          if (verdict.kind !== "allowed") refuse(verdict);

          const encoded = encodeGoldcoinDestination(recipient);
          if (!encoded.ok) throw new Error(encoded.message);
          const result = await robinhoodDeposit.deposit({
            // Taken from the form's own 18-decimal figure, never
            // re-widened from the canonical one: re-deriving it would
            // round a user's amount to something they did not type.
            amountRaw: BigInt(amountValidation.raw),
            destination: encoded.value.hex,
          });
          setPhase({ kind: "robinhood-deposit-submitted", hash: result.hash });
          // The approval and the deposit have both confirmed by this point,
          // so the on-chain balance has genuinely changed.
          refreshSourceBalance();
          break;
        }
      }
    } catch (error) {
      setSubmitError(error);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Re-reads the source wallet's balance after a transaction has moved it.
   *
   * Invalidated by key PREFIX, so it covers whichever chain's balance is
   * in play without this function knowing which one that is. Polling would
   * catch the change within thirty seconds anyway; this makes the number
   * under MAX correct immediately, which is when someone is most likely to
   * look at it.
   */
  function refreshSourceBalance() {
    void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances() });
    void queryClient.invalidateQueries({ queryKey: evmWalletQueryKeys.balances() });
  }

  /**
   * The highest `bridge_requests.id` this wallet already has, or `0` when
   * it has none — every real id is positive, so `0` still correctly means
   * "any id that appears is unambiguously new". `null` is reserved for
   * "this read itself failed", which `pollForTransfer` must not treat the
   * same way: there, no id is safe as a floor, so it must not guess.
   */
  async function highestKnownRequestId(address: string | null): Promise<number | null> {
    if (!address) return null;
    const page = await bridgeApi.listTransfers({ address, limit: 1 });
    return page.items[0]?.id ?? 0;
  }

  /**
   * Finds the request this specific deposit created and redirects to it.
   *
   * The backend has no field correlating a contract-funded request to the
   * wallet transaction that created it, so this must not just take the
   * first matching item: an older request would already be in the very
   * first poll response. Requiring `id > baselineRequestId` — captured
   * before submission — rules out every request that could have existed
   * beforehand. If no baseline could be established, or polling times
   * out, it sends the user to their own activity list rather than risking
   * a redirect to the wrong request.
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
          // Keep polling silently; the waiting copy already tells the user
          // their deposit is on-chain regardless of this poll's outcome.
        }
      }
    }
    router.push(`${routes.activity}?address=${encodeURIComponent(address)}`);
  }
}

/** Post-submission states. Each names what has happened and what happens next. */
function SubmittedPhase({
  phase,
  router,
}: {
  phase: Exclude<Phase, { kind: "form" }>;
  router: ReturnType<typeof useRouter>;
}) {
  if (phase.kind === "goldcoin-deposit") {
    return (
      <Card variant="raised" padding="md">
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

  if (phase.kind === "solana-deposit-submitted") {
    return (
      <Card variant="raised" padding="md">
        <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
        <p className="text-body-sm text-ink-600">
          Your Solana transaction has been submitted (signature{" "}
          {phase.signature.slice(0, 12)}…). Waiting for the bridge to observe it — this
          page will move on automatically once it does.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="raised" padding="md">
      <h1 className="text-heading-2 mb-2">Deposit submitted</h1>
      <p className="text-body-sm text-ink-600">
        Your Robinhood Chain transaction has confirmed (transaction{" "}
        {phase.hash.slice(0, 12)}…). The bridge indexes the deposit from the
        contract&apos;s own event, so your transfer will appear in your activity once it
        has been observed.
      </p>
      <Button className="mt-4" fullWidth onClick={() => router.push(routes.activity)}>
        View my activity
      </Button>
    </Card>
  );
}

/**
 * The "Min … · Max …" line, or `null` when this pair publishes neither.
 *
 * Built by joining the parts that exist rather than by branching in JSX,
 * so a separator can never outlive the bound beside it — the state a
 * Robinhood pair is permanently in, carrying a maximum and no minimum.
 */
function boundsSummary(bounds: AmountBounds): string | null {
  const parts: string[] = [];
  if (bounds.minimum !== undefined) {
    parts.push(`Min ${display(bounds.minimum, bounds.decimals, bounds.symbol)}`);
  }
  if (bounds.maximum !== undefined) {
    parts.push(`Max ${display(bounds.maximum, bounds.decimals, bounds.symbol)}`);
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * Whether the limits line has anything at all to say.
 *
 * The remainder can outlive both bounds. On a Robinhood pair every figure
 * comes from one response, but they are independently nullable: a
 * deployment whose contract answered `limits()` with nulls and still
 * published a window would have a remainder and no bounds. Gating the
 * line on the bounds alone would blank a figure that had arrived, which
 * is the mistake the old `minimum !== undefined` gate made in the other
 * direction.
 */
function hasLimitsToShow(bounds: AmountBounds, remaining: string | null): boolean {
  return boundsSummary(bounds) !== null || remaining !== null;
}

/**
 * Source options: every network this build describes that has at least one
 * defined outbound route. Availability is per-PAIR, so a source's own
 * status line stays coarse — the destination selector and the summary
 * carry the precise answer.
 */
function sourceOptions(
  chains: Parameters<typeof routeAvailability>[0],
  selectedSourceId: string,
): readonly NetworkOption[] {
  return CHAIN_DESCRIPTORS.filter((chain) => destinationsFor(chain.id).length > 0).map(
    (chain) => {
      const anyOpen = destinationsFor(chain.id).some((destinationId) => {
        const resolved = resolveRoute(chain.id, destinationId);
        return (
          resolved.kind === "route" &&
          routeAvailability(chains, resolved.route).kind === "open"
        );
      });
      return {
        chain,
        selectable: true,
        status:
          chain.id === selectedSourceId
            ? "Selected"
            : anyOpen
              ? "Routes available"
              : "No routes open yet",
      };
    },
  );
}

/**
 * Destination options for the selected source. Every entry's status is the
 * real state of THAT pair, read from `/chains`.
 */
function destinationOptions(
  chains: Parameters<typeof routeAvailability>[0],
  sourceChainId: string,
): readonly NetworkOption[] {
  return CHAIN_DESCRIPTORS.map((chain): NetworkOption => {
    if (chain.id === sourceChainId) {
      // There is no self-route: this bridge moves GLC between networks.
      return { chain, selectable: false, status: "Same network" };
    }
    const resolved = resolveRoute(sourceChainId, chain.id);
    if (resolved.kind !== "route") {
      return { chain, selectable: false, status: "No route" };
    }
    const state = routeAvailability(chains, resolved.route);
    switch (state.kind) {
      case "open":
        // Open on the backend, and separately: can this app start it? A
        // route this build has no source-transaction payload for is shown
        // as such HERE, in the selector, rather than only after it is
        // chosen — the whole point of the status line is that a user can
        // see what a pair will do before committing to it.
        return isRouteExecutableHere(resolved.route)
          ? { chain, selectable: true, status: "Available" }
          : {
              chain,
              selectable: true,
              status: "Not in this app yet",
              // Short, because the selector is a list. The full sentence —
              // which route, what is missing, and that nothing has moved —
              // is the blocker callout's job once the pair is chosen.
              detail:
                "This route is live on the bridge, but cannot be started from this app yet.",
            };
      case "closed":
        // Selectable on purpose: choosing a closed route is allowed, and
        // the form then explains why it cannot be used. Hiding it would
        // leave a user unable to find out.
        //
        // Not "Coming soon". Every route the backend names is built, so a
        // closed one is switched off rather than unreleased, and promising
        // a launch here would be this UI inventing one.
        return {
          chain,
          selectable: true,
          status: "Currently unavailable",
          detail: state.reason,
        };
      case "unavailable":
        // Switched on, currently refused by its destination reserve.
        // Selectable for the same reason as `closed`, and worded
        // differently because this one reopens without anyone doing
        // anything.
        return {
          chain,
          selectable: true,
          status: "Temporarily unavailable",
          detail: state.reason,
        };
      case "unimplemented":
        return { chain, selectable: true, status: "Not available", detail: state.reason };
      case "unknown":
        return { chain, selectable: false, status: "Checking…" };
    }
  });
}

interface Gate {
  readonly can: boolean;
  readonly reason: string | null;
  readonly reasonShownInline: boolean;
  readonly blocker: Blocker | null;
  /** The primary button's label, which states what pressing it would do. */
  readonly cta: string;
  /**
   * A second line for the blocker callout — today only the backend's own
   * "you can try again in about N hours" for the Robinhood rolling
   * windows. `null` for every blocker whose approved copy is one
   * sentence, which is all of the pre-existing ones.
   */
  readonly detail: string | null;
}

interface GateInput {
  resolution: ReturnType<typeof resolveRoute>;
  availability: ReturnType<typeof routeAvailability>;
  /**
   * Whether this build can build the route's source transaction at all.
   * `null` only when the pair resolves to no route, which step 1 below has
   * already refused.
   */
  execution: ReturnType<typeof routeExecutionSupport> | null;
  chainsPending: boolean;
  chainsError: boolean;
  statusPending: boolean;
  statusError: boolean;
  limitsPending: boolean;
  reservePending: boolean;
  sourceAdapter: ChainAdapter | null;
  destinationAdapter: ChainAdapter | null;
  dirState: ReturnType<typeof directionGateState> | null;
  remainingMintRaw: string | null;
  destinationReserveCapacity: string | null;
  amountValidation: ReturnType<typeof validateAmount> | null;
  amountIsCanonical: boolean;
  recipientValid: boolean;
  recipientMessage: string | null;
  recipientTouched: boolean;
  recipientRaw: string;
  sourceToken: { decimals: number; symbol: string };
  routeLabel: string;
  solanaCapability: (glcAddressBytes: number) => {
    available: boolean;
    message: string | null;
  };
  robinhoodCapability: () => { available: boolean; message: string | null };
  eligibility: {
    applies: boolean;
    pending: boolean;
    data: RecipientEligibilityDto | null;
  };
  /**
   * The RhnToGlc pre-deposit gate. `applies` is false for every other
   * route, which is what keeps their gates byte-for-byte unchanged.
   */
  predeposit: {
    applies: boolean;
    pending: boolean;
    verdict: RobinhoodPredepositVerdict | null;
  };
  quotePending: boolean;
  quoteError: boolean;
}

/**
 * Every reason this transfer cannot be submitted, in the order a user can
 * act on them.
 *
 * Extracted from the component so the ordering is readable in one piece
 * and testable on its own. The order is the design: a closed route is
 * stated before any wallet is asked for, because a wallet prompt for a
 * route that cannot run wastes the user's time and teaches them to click
 * through prompts.
 */
function computeGate(input: GateInput): Gate {
  const blocked = (reason: string, extra: Partial<Gate> = {}): Gate => ({
    can: false,
    reason,
    reasonShownInline: false,
    blocker: null,
    cta: "Bridge GLC",
    detail: null,
    ...extra,
  });

  // 1. Is this pair even a route?
  if (input.resolution.kind === "same-chain") {
    return blocked("Choose two different networks.", { cta: "Choose networks" });
  }
  if (input.resolution.kind === "undefined-pair") {
    return blocked("This bridge has no route between those networks.", {
      cta: "Route unavailable",
      blocker: "route-closed",
    });
  }
  if (!input.sourceAdapter || !input.destinationAdapter) {
    // A network `/chains` names but this build cannot describe. Refused
    // rather than transacted on with another network's rules.
    return blocked("This app cannot bridge that network yet.", {
      cta: "Route unavailable",
      blocker: "route-closed",
    });
  }

  // 2. Is it open? Straight from /chains, before anything else is asked.
  if (input.chainsPending) {
    return blocked("Loading route availability…", { cta: "Bridge GLC" });
  }
  if (input.chainsError) {
    // Distinct from "this route is closed": nothing was refused, the
    // registry simply could not be read. Reported as an unreachable
    // service rather than as a verdict about the route.
    return blocked("Bridge status is unavailable.", { blocker: "unavailable" });
  }
  if (input.availability.kind !== "open") {
    return blocked(input.availability.reason, {
      cta: "Route unavailable",
      // `unavailable` is a route that IS switched on and is being held
      // shut by a runtime gate on its destination reserve. Saying
      // "closed" there would send a user looking for a setting somebody
      // has to change, when in fact it reopens on its own.
      blocker:
        input.availability.kind === "unavailable" ? "route-unavailable" : "route-closed",
    });
  }

  // 2a. EFFECTIVE availability, for the one route with no backend
  // preflight in front of an irreversible deposit. `enabled` says the
  // route gate is open and reads no reserve state at all; `available`
  // says the destination reserve would actually admit a deposit started
  // now. A deployment that publishes neither answer gets refused here
  // rather than falling back to the half of the question it did answer —
  // an unknown must never render as a yes when the cost of being wrong
  // is a user's funds already in the custody contract.
  if (
    input.predeposit.applies &&
    input.predeposit.verdict?.kind === "route-unavailable"
  ) {
    return blocked(input.predeposit.verdict.reason, {
      cta: "Route unavailable",
      blocker: "route-unavailable",
    });
  }

  // 2a'. Can this BUILD start the route? A fact about the app, not a
  // verdict from the backend — and deliberately NOT folded into
  // availability, because /chains reports these routes open on a deployment
  // that has them open and they ARE open. What is missing is a
  // source-transaction payload this app can construct correctly, and
  // guessing one would commit a user's GLC on-chain with no way back
  // (`@/lib/bridge/route-execution`).
  //
  // Checked AFTER the backend's verdict, not before it. On a route the
  // backend has closed, its own sentence is the operative answer and this
  // app's separate limitation is moot — leading with ours would explain a
  // refusal nobody had reached yet. Checked before any wallet is asked for,
  // for the same reason a closed route is: no connect prompt for a transfer
  // that cannot be submitted.
  if (input.execution?.kind === "unsupported-here") {
    return blocked(input.execution.reason, {
      cta: "Not available in this app",
      blocker: "route-not-executable-here",
      reasonShownInline: true,
    });
  }

  // 2b. Source-side readiness that no amount or address can fix — an
  // unconfigured deployment, a missing browser wallet, a wallet on the
  // wrong network. Checked BEFORE the amount and the address, because
  // "enter an amount" is unhelpful advice when the real problem is that
  // this build cannot reach the network at all.
  //
  // The amount and address legs of that capability are neutralised here:
  // the gate has its own steps for both, with messages that name the
  // specific defect rather than a generic refusal.
  if (input.sourceAdapter.funding === "evm-contract") {
    const capability = input.robinhoodCapability();
    if (!capability.available) {
      return blocked(capability.message ?? "This route is unavailable.", {
        cta: capability.message?.startsWith("Connect")
          ? "Connect wallet"
          : "Route unavailable",
      });
    }
  }

  if (input.statusPending || input.limitsPending || input.reservePending) {
    return blocked("Loading bridge status…");
  }
  if (input.statusError) {
    return blocked("Bridge status is unavailable.", { blocker: "unavailable" });
  }

  // 3. Reserve and quota state, for the routes /status describes.
  if (input.dirState === "quota-paused") {
    return blocked(`${QUOTA_PAUSED_TITLE} ${QUOTA_PAUSED_BODY}`, {
      blocker: "quota-paused",
      cta: "Route unavailable",
    });
  }
  if (input.dirState === "quota-exhausted") {
    return blocked(`${QUOTA_EXHAUSTED_TITLE} ${QUOTA_EXHAUSTED_BODY}`, {
      blocker: "quota-exhausted",
      cta: "Route unavailable",
    });
  }
  if (input.dirState === "operator-paused") {
    return blocked(`${input.routeLabel} is currently paused.`, {
      blocker: "paused",
      cta: "Route unavailable",
    });
  }
  if (
    input.dirState === "capacity-constrained" ||
    (input.destinationReserveCapacity !== null &&
      BigInt(input.destinationReserveCapacity) <= 0n)
  ) {
    return blocked("Insufficient reserve liquidity for this route right now.", {
      blocker: "insufficient-liquidity",
      cta: "Route unavailable",
    });
  }

  // 4. The amount.
  if (!input.amountValidation || input.amountValidation.raw === null) {
    const reportable = isReportableProblem(input.amountValidation?.problem ?? null);
    return blocked(reportable ? input.amountValidation!.message! : "Enter an amount.", {
      reasonShownInline: reportable,
      cta: "Enter an amount",
    });
  }
  if (input.remainingMintRaw !== null) {
    const remainingCanonical = BigInt(
      sourceRawToCanonical(input.remainingMintRaw, SOLANA_GLC.decimals),
    );
    const grossCanonical = BigInt(
      sourceRawToCanonical(input.amountValidation.raw, input.sourceToken.decimals),
    );
    if (grossCanonical > remainingCanonical) {
      const remainingDisplay = display(
        atomicRescaleFloor(
          input.remainingMintRaw,
          SOLANA_GLC.decimals,
          input.sourceToken.decimals,
        ),
        input.sourceToken.decimals,
        input.sourceToken.symbol,
      );
      return blocked(
        `That amount exceeds the remaining 24-hour bridge capacity for this route (${remainingDisplay} remaining). Enter a smaller amount, or check back after capacity is replenished.`,
      );
    }
  }
  if (!input.amountIsCanonical) {
    const trimmedTo = largestCanonicalRobinhoodAmountAtMost(input.amountValidation.raw);
    return blocked(
      `The bridge settles amounts to 8 decimal places, and the custody contract rejects anything finer rather than rounding it. The nearest amount it accepts at or below yours is ${display(trimmedTo, input.sourceToken.decimals, input.sourceToken.symbol)}.`,
    );
  }

  // 5. The destination address.
  if (!input.recipientValid) {
    const reportable = input.recipientTouched && input.recipientMessage !== null;
    return blocked(input.recipientMessage ?? "Enter a destination address.", {
      reasonShownInline: reportable,
      cta: "Enter destination",
    });
  }

  // 6. Source-side wallet capability, per funding kind.
  if (input.sourceAdapter.funding === "solana-program") {
    const capability = input.solanaCapability(
      new TextEncoder().encode(input.recipientRaw.trim()).length,
    );
    if (!capability.available) {
      return blocked(capability.message ?? "This route is unavailable.", {
        cta: capability.message?.startsWith("Connect")
          ? "Connect wallet"
          : "Route unavailable",
      });
    }
  }

  // 7. Rate limits, for the one route that has them.
  if (input.eligibility.applies) {
    if (input.eligibility.pending) {
      return blocked("Checking this address's recent bridge activity…");
    }
    const data = input.eligibility.data;
    if (data && !data.eligible) {
      // Wallet-first, matching the backend's own precedence. Both limits
      // are independently enforced regardless of which is surfaced.
      return data.blocked_reason === "source_wallet_rate_limited"
        ? blocked(SOURCE_WALLET_RATE_LIMIT_TITLE, {
            blocker: "source-wallet-rate-limited",
            cta: "Route unavailable",
          })
        : blocked(RECIPIENT_RATE_LIMIT_TITLE, {
            blocker: "recipient-rate-limited",
            cta: "Route unavailable",
          });
    }
    // A FAILED eligibility read deliberately does not block: the backend
    // re-checks the same rule authoritatively at admission, and submit()
    // makes one more fresh attempt right before the wallet opens.
  }

  // 7b. The same two rolling-24h limits for RhnToGlc — and, unlike above,
  // FAIL CLOSED on a read that did not complete.
  //
  // The asymmetry is deliberate and is the whole point of this gate. A
  // blocked SolToGlc deposit lands in a Solana program the bridge
  // controls, so failing open there degrades to a slower transfer. A
  // blocked Robinhood deposit is taken by the custody contract and parked
  // in ManualReview; failing open there costs a user their GLC for as
  // long as a human takes to look at it. So pending, failed, absent, and
  // "about different inputs than the form now holds" are all refusals.
  if (input.predeposit.applies) {
    if (input.predeposit.pending) {
      return blocked("Checking this deposit against the bridge's limits…");
    }
    const verdict = input.predeposit.verdict;
    switch (verdict?.kind) {
      case "allowed":
        break;
      case "source-wallet-rate-limited":
        return blocked(ROBINHOOD_SOURCE_WALLET_RATE_LIMIT_TITLE, {
          blocker: "robinhood-source-wallet-rate-limited",
          cta: "Route unavailable",
          detail: verdict.retryAfter,
        });
      case "recipient-rate-limited":
        return blocked(ROBINHOOD_RECIPIENT_RATE_LIMIT_TITLE, {
          blocker: "robinhood-recipient-rate-limited",
          cta: "Route unavailable",
          detail: verdict.retryAfter,
        });
      default:
        // `route-unavailable` was already returned at step 2a; everything
        // remaining is an answer this form could not use, which is not a
        // rate limit and must not be described as one.
        return blocked(ROBINHOOD_ELIGIBILITY_UNKNOWN_TITLE, {
          blocker: "robinhood-eligibility-unknown",
          cta: "Route unavailable",
        });
    }
  }

  // 8. The quote.
  if (input.quotePending) return blocked("Fetching quote…");
  if (input.quoteError) return blocked("Could not fetch a quote for this amount.");

  return {
    can: true,
    reason: null,
    reasonShownInline: false,
    blocker: null,
    cta: "Bridge GLC",
    detail: null,
  };
}

"use client";

import { useId } from "react";
import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import {
  useBridgeStatus,
  useChains,
  useHealth,
  useReserve,
  useRobinhoodReserve,
} from "@/lib/query/hooks";
import {
  directionAvailabilityStatus,
  routeAvailabilityStatus,
  systemStatus,
  type StatusDescriptor,
} from "@/lib/status";
import type { DirectionAvailability } from "@/lib/status";
import {
  directionGateState,
  directions,
  displayDescriptorFor,
  isRouteOpen,
  robinhoodDestinationCapacity,
  robinhoodRouteGateState,
  robinhoodWindowRemaining,
  routeAvailability,
  GOLDCOIN_GLC,
  SOLANA_GLC,
} from "@/lib/bridge";
import type {
  DirectionGateState,
  RobinhoodFigure,
  RobinhoodRoute,
  RobinhoodRouteGateState,
  SolanaGovernedRoute,
} from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import type { RobinhoodReserveDto } from "@/lib/api/schemas/robinhood";
import { clampAtomicAtZero } from "@/lib/api/schemas/common";

/**
 * One route's card at the top of /status: a badge, the capacity of the
 * reserve it pays out of, and what is left of its rolling 24-hour window.
 *
 * Built as data rather than as JSX per route, because the two Robinhood
 * routes answer the same three questions from entirely different endpoints
 * — a third reserve ledger, a custody contract's own kill switches and
 * windows, an indexer's liveness — and the alternative to a common shape
 * is a second copy of the card that could drift from the first.
 *
 * Every optional field is optional for one reason: the backend may
 * genuinely not publish that figure. `null` is rendered as an explicit
 * "not published", never as a zero and never as an empty slot that reads
 * as one.
 */
interface RouteStatusCard {
  readonly key: string;
  readonly title: string;
  readonly status: StatusDescriptor;
  /** The destination reserve's available capacity, at its own decimals. */
  readonly capacity: RobinhoodFigure | null;
  /** Headroom left in this route's rolling 24-hour window. */
  readonly window: RobinhoodFigure | null;
  /** Said only when it adds something the badge does not. */
  readonly note?: string;
}

export function StatusView() {
  const status = useBridgeStatus();
  const chains = useChains();
  const health = useHealth();
  const reserve = useReserve();
  // Fetched only once `/chains` positively reports a Robinhood route open.
  // `/chains` stays the single availability authority; this endpoint
  // repeats its verdict and adds the figures, so asking for it before the
  // authority says the route is live would be asking the wrong source
  // first — and on a deployment predating the endpoint, asking at all is a
  // 404 per poll tick for a route nobody can use.
  const robinhoodLive =
    isRouteOpen(chains.data, "GlcToRhn") || isRouteOpen(chains.data, "RhnToGlc");
  const robinhood = useRobinhoodReserve(robinhoodLive);

  if (status.isPending || health.isPending || reserve.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }

  if (status.isError) return <ErrorState error={status.error} />;
  if (health.isError) return <ErrorState error={health.error} />;
  if (reserve.isError) return <ErrorState error={reserve.error} />;

  const data = status.data;
  const h = health.data;

  // Per-direction state from the same derivation the bridge form uses —
  // quota states are distinguished from an operator pause and from
  // reserve-capacity constraints, matching the backend's own composition.
  const GATE_TO_BADGE: Record<DirectionGateState, DirectionAvailability> = {
    active: "available",
    "operator-paused": "paused",
    "capacity-constrained": "insufficient-liquidity",
    "quota-exhausted": "quota-exhausted",
    "quota-paused": "quota-paused",
  };
  const availability = (direction: SolanaGovernedRoute) =>
    directionAvailabilityStatus[GATE_TO_BADGE[directionGateState(data, direction)]];

  /*
   * The two Solana-governed routes, exactly as before: `GET /status`'s own
   * per-direction fields, `GET /reserve`'s two capacities, and the
   * mint-atomic (6-decimal) rolling window. Nothing about this pair is
   * routed through the Robinhood derivation — its endpoint knows nothing
   * about them, and the whole point of keeping the two derivations apart
   * is that neither can answer with the other's numbers.
   */
  const cards: RouteStatusCard[] = [
    {
      key: "GlcToSol",
      title: directions.GlcToSol.label,
      status: availability("GlcToSol"),
      capacity: {
        atomic: clampAtomicAtZero(reserve.data.solana_available_capacity),
        decimals: SOLANA_GLC.decimals,
      },
      window: {
        atomic: data.glc_to_sol_rolling_volume_remaining,
        decimals: SOLANA_GLC.decimals,
      },
    },
    {
      key: "SolToGlc",
      title: directions.SolToGlc.label,
      status: availability("SolToGlc"),
      capacity: {
        atomic: clampAtomicAtZero(reserve.data.goldcoin_available_capacity),
        decimals: GOLDCOIN_GLC.decimals,
      },
      window: {
        atomic: data.sol_to_glc_rolling_volume_remaining,
        decimals: SOLANA_GLC.decimals,
      },
    },
    /*
     * A Robinhood route earns a card only once `/chains` reports it open.
     * Before that there is no live route to describe and no figure the
     * backend publishes for it — the Routes card below already lists it as
     * unavailable, with the backend's own reason. Adding a second, emptier
     * card saying the same thing would be noise, and one filled with
     * placeholder zeroes would be worse.
     */
    ...ROBINHOOD_ROUTES.filter((route) => isRouteOpen(chains.data, route)).map((route) =>
      robinhoodCard(
        route,
        robinhood.data,
        clampAtomicAtZero(reserve.data.goldcoin_available_capacity),
      ),
    ),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <RouteCard key={card.key} card={card} />
        ))}
      </div>

      <RouteAvailabilityCard chains={chains.data} isPending={chains.isPending} />

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <HeartPulse aria-hidden="true" className="text-ink-500 size-4" />
          <h2 className="text-heading-3">System health</h2>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-body-sm text-ink-500">Overall</dt>
            <dd className="mt-1">
              <StatusBadge
                status={h.healthy ? systemStatus.operational : systemStatus.degraded}
                size="sm"
              />
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Goldcoin indexer</dt>
            <dd className="mt-1">
              <StatusBadge
                status={
                  h.goldcoin_indexer_halted
                    ? systemStatus.paused
                    : systemStatus.operational
                }
                size="sm"
              />
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Manual review backlog</dt>
            <dd className="tabular text-heading-3 mt-1">{h.manual_review_backlog}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Reorg events</dt>
            <dd className="tabular text-heading-3 mt-1">
              {h.post_finality_reorg_events}
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

/** The two routes whose figures come from `GET /robinhood/reserve`. */
const ROBINHOOD_ROUTES: readonly RobinhoodRoute[] = ["GlcToRhn", "RhnToGlc"];

/**
 * The Robinhood gate states, in the shared availability vocabulary.
 *
 * Both pauses map to the same badge on purpose: to a user, "the operator
 * paused this reserve" and "governance flipped the contract's kill switch
 * for this leg" are one fact — transfers are not moving — and the badge
 * says that. WHICH of the two it was is a real distinction, so it is
 * carried in the note beneath rather than dropped.
 */
const ROBINHOOD_GATE_TO_BADGE: Record<RobinhoodRouteGateState, DirectionAvailability> = {
  active: "available",
  "operator-paused": "paused",
  "contract-paused": "paused",
  "capacity-constrained": "insufficient-liquidity",
  "quota-exhausted": "quota-exhausted",
  degraded: "degraded",
  unknown: "unknown",
};

/**
 * The extra sentence a Robinhood card carries, where the badge alone would
 * leave a reader guessing. Deliberately silent for the states the badge
 * already says everything about.
 */
const ROBINHOOD_GATE_NOTE: Partial<Record<RobinhoodRouteGateState, string>> = {
  "contract-paused":
    "Paused on the Robinhood custody contract itself, not by this bridge.",
  degraded:
    "The Robinhood custody contract or its indexer could not be read just now, so the figures below may be behind the chain.",
  unknown:
    "This deployment publishes no Robinhood reserve, so no capacity or 24-hour figure can be shown for this route.",
};

/**
 * One Robinhood route's card, assembled from `GET /robinhood/reserve` —
 * and, for `RhnToGlc`, from `GET /reserve`'s Goldcoin capacity, because
 * that is the reserve it actually pays out of.
 *
 * The badge and the capacity figure are derived from the same resolved
 * value, so a card can never show "Available" beside a capacity read from
 * a different source than the one that decided it.
 */
function robinhoodCard(
  route: RobinhoodRoute,
  reserve: RobinhoodReserveDto | undefined,
  goldcoinCapacityAtomic: string,
): RouteStatusCard {
  const capacity = robinhoodDestinationCapacity(route, reserve, goldcoinCapacityAtomic);
  const gate = robinhoodRouteGateState(route, reserve, capacity?.atomic ?? null);
  const note = ROBINHOOD_GATE_NOTE[gate];
  return {
    key: route,
    title: directions[route].label,
    status: directionAvailabilityStatus[ROBINHOOD_GATE_TO_BADGE[gate]],
    // Capacity is clamped for display only. A negative capacity is a real
    // diagnostic state the backend reports rather than hides, but "-2 GLC
    // of headroom" is not a sentence a user can act on: it means none.
    capacity: capacity
      ? { atomic: clampAtomicAtZero(capacity.atomic), decimals: capacity.decimals }
      : null,
    window: robinhoodWindowRemaining(route, reserve),
    ...(note ? { note } : {}),
  };
}

/**
 * One route card. Identical in shape for every route; only where its three
 * figures came from differs, and that is resolved before this renders.
 *
 * A missing figure says so in words. It is never a blank, a dash beside a
 * unit, or a zero — on a page whose entire job is to state what the bridge
 * can do right now, "0 GLC of capacity" and "we do not publish that" are
 * opposite claims.
 */
function RouteCard({ card }: { card: RouteStatusCard }) {
  const headingId = useId();
  return (
    /*
      A labelled group, not a bare div. Every card repeats the same two
      terms — "Destination reserve capacity", "Remaining 24-hour capacity
      for this direction" — so with four routes on the page a reader
      navigating by anything other than sight would meet the phrase four
      times with nothing tying it to a route. The route's own heading is
      that tie.
    */
    <Card role="group" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
          <h2 id={headingId} className="text-heading-3">
            {card.title}
          </h2>
        </div>
        <StatusBadge status={card.status} />
      </div>
      {card.note && <p className="text-body-sm text-ink-500 mt-2">{card.note}</p>}
      <div className="mt-3">
        {card.capacity ? (
          <TokenAmount
            raw={card.capacity.atomic}
            decimals={card.capacity.decimals}
            symbol="GLC"
            className="text-heading-2"
          />
        ) : (
          <p className="text-heading-3 text-ink-500">Not published</p>
        )}
        <p className="text-body-sm text-ink-500 mt-1">Destination reserve capacity</p>
      </div>
      <div className="mt-2">
        {card.window ? (
          <TokenAmount
            raw={card.window.atomic}
            decimals={card.window.decimals}
            symbol="GLC"
          />
        ) : (
          <p className="text-body-sm text-ink-500">Not published</p>
        )}
        <p className="text-body-sm text-ink-500 mt-1">
          Remaining 24-hour capacity for this direction
        </p>
      </div>
    </Card>
  );
}

/**
 * Every route the backend knows about, and whether it is open — read
 * straight from `GET /chains`.
 *
 * # Iterated from the response, not from a local list
 *
 * The rows are whatever `/chains` returned. A route — or a whole network —
 * the backend adds later appears here with no frontend deploy, which is
 * the same property that lets the bridge form scale. Networks this build
 * cannot describe still render, by their backend id, rather than being
 * dropped from a list a user is using to check what is supported.
 *
 * # Why this carries no numbers
 *
 * The cards above pair a route with its destination reserve's capacity and
 * its rolling window. This list is the complete registry, and it includes
 * routes for which no such figures exist — `SolToRhn`/`RhnToSol` have no
 * settlement machinery on either side, so there is no reserve paying them
 * and no window bounding them, and a network the backend adds later may
 * arrive here before this build can describe it at all.
 *
 * So this card states availability and stops. It does not estimate a
 * capacity, borrow another route's figure, or render an empty placeholder
 * that reads as "zero" — an absent number is shown as absent.
 *
 * (The Robinhood reserve's own capacity, pause flag and contract windows
 * DO have a public endpoint now — `GET /robinhood/reserve` — and they are
 * rendered on that route's card above once `/chains` reports it open. They
 * are deliberately not repeated here: this list answers one question, and
 * mixing figures into it would make a closed route look measurable.)
 */
function RouteAvailabilityCard({
  chains,
  isPending,
}: {
  chains: ChainsViewDto | undefined;
  isPending: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Activity aria-hidden="true" className="text-ink-500 size-4" />
        <h2 className="text-heading-3">Routes</h2>
      </div>
      {isPending || !chains ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col gap-3">
          {chains.routes.map((view) => {
            const source = displayDescriptorFor(view.source_chain);
            const destination = displayDescriptorFor(view.destination_chain);
            const state = routeAvailability(chains, view.id);
            return (
              <li
                key={view.id}
                className="border-ink-100 flex flex-col gap-1 border-b pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="text-body-sm text-ink-900 font-medium">
                    {source.name} → {destination.name}
                  </p>
                  <p className="text-body-sm text-ink-500">{view.id}</p>
                </div>
                <div className="sm:max-w-[60%] sm:text-right">
                  {/* The four availability kinds have their own status
                      descriptors: "Not implemented" is neutral rather than
                      danger, because nothing is wrong and nothing is
                      waiting to be switched back on. */}
                  <StatusBadge status={routeAvailabilityStatus[state.kind]} size="sm" />
                  {state.kind !== "open" && (
                    <p className="text-body-sm text-ink-500 mt-1 whitespace-pre-line">
                      {state.kind === "unimplemented"
                        ? "Not available on this deployment."
                        : state.kind === "unknown"
                          ? "Availability could not be read."
                          : state.reason}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

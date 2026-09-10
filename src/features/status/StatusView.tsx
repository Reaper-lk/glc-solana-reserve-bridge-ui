"use client";

import { useId } from "react";
import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import {
  useBridgeStatus,
  useChains,
  useHealth,
  useLimits,
  useReserve,
  useRobinhoodReserve,
} from "@/lib/query/hooks";
import {
  executableRouteStatusBadge,
  routeAvailabilityStatus,
  systemStatus,
} from "@/lib/status";
import {
  displayDescriptorFor,
  executableRouteStatuses,
  isRouteEnabled,
  routeAvailability,
} from "@/lib/bridge";
import type { ExecutableRouteStatus, RouteFigure } from "@/lib/bridge";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";

/**
 * /status, modelled on the route registry rather than on two directions.
 *
 * Every figure on this page is resolved by `@/lib/bridge/route-status`,
 * which keys each one to the route it belongs to through a total map with
 * no default branch. This component fetches and renders; it decides
 * nothing about where a number came from, which is what stops a Robinhood
 * card from being filled with Solana's reserve or a Goldcoin-settled route
 * from borrowing the Robinhood ledger's.
 */
export function StatusView() {
  const status = useBridgeStatus();
  const chains = useChains();
  const health = useHealth();
  const reserve = useReserve();
  const limits = useLimits();
  // Fetched only once `/chains` reports this DEPLOYMENT has a Robinhood
  // route at all. `isRouteEnabled`, not `isRouteOpen`: a route that is
  // switched on and momentarily gated shut by its destination reserve
  // still has the endpoint, and is exactly the state a status page exists
  // to report. A deployment without the route answers 404 per poll tick,
  // which is what this avoids.
  const robinhoodLive =
    isRouteEnabled(chains.data, "GlcToRhn") || isRouteEnabled(chains.data, "RhnToGlc");
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

  const h = health.data;

  const cards = executableRouteStatuses({
    chains: chains.data,
    status: status.data,
    reserve: reserve.data,
    robinhood: robinhood.data,
    limits: limits.data,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <RouteCard key={card.route} card={card} />
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

/** "300" -> "3%", "50" -> "0.5%". Integer arithmetic; never a float rate. */
function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${(bps / 100).toFixed(2)}%`;
}

/**
 * A figure, or the words that say the backend did not publish one.
 *
 * Never a blank, a dash beside a unit, or a zero. On a page whose entire
 * job is to state what the bridge can do right now, "0 GLC of capacity"
 * and "we do not publish that" are opposite claims.
 */
function Figure({
  figure,
  className,
}: {
  figure: RouteFigure | null;
  className?: string;
}) {
  if (!figure) return <span className="text-ink-500">Not published</span>;
  return (
    <TokenAmount
      raw={figure.atomic}
      decimals={figure.decimals}
      symbol="GLC"
      {...(className ? { className } : {})}
    />
  );
}

/**
 * One executable route's card: what it is, whether it can be used right
 * now, and the figures that bound it.
 *
 * `Enabled` and `Available` are shown as separate rows on purpose. They
 * answer different questions — the first is the route gate over config,
 * the `bridge_routes` table and adapter capability; the second is that AND
 * every runtime gate on the DESTINATION reserve — and reading the first as
 * permission is exactly what let `RhnToGlc` deposits reach a Goldcoin
 * reserve whose admission was closed. A reader looking at a route that is
 * switched on and still refused can see both facts here rather than
 * inferring one from the other.
 */
function RouteCard({ card }: { card: ExecutableRouteStatus }) {
  const headingId = useId();
  return (
    /*
      A labelled group, not a bare div. Every card repeats the same terms —
      "Destination reserve capacity", "Remaining 24-hour capacity" — so
      with four routes on the page a reader navigating by anything other
      than sight would meet each phrase four times with nothing tying it to
      a route. The route's own heading is that tie.
    */
    <Card role="group" aria-labelledby={headingId}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
          <h2 id={headingId} className="text-heading-3">
            {card.label}
          </h2>
        </div>
        <StatusBadge status={executableRouteStatusBadge[card.kind]} />
      </div>

      {/* The backend's own sentence, verbatim. This UI never authors a
          second explanation of a backend decision and never infers which
          gate refused — the response deliberately does not say. */}
      {card.reason && (
        <p className="text-body-sm text-ink-500 mt-2 whitespace-pre-line">
          {card.reason}
        </p>
      )}
      {card.note && <p className="text-body-sm text-ink-500 mt-2">{card.note}</p>}

      <div className="mt-3">
        <Figure figure={card.capacity} className="text-heading-2" />
        <p className="text-body-sm text-ink-500 mt-1">Destination reserve capacity</p>
      </div>

      <div className="mt-2">
        <Figure figure={card.window} />
        <p className="text-body-sm text-ink-500 mt-1">
          Remaining 24-hour capacity for this direction
        </p>
      </div>

      <dl className="border-ink-100 mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3">
        {/* Qualified rather than bare "Enabled" / "Available": the badge
            above already carries the word "Available", and two things on
            one card reading "Available" with different meanings is exactly
            the confusion these rows exist to remove. */}
        <div>
          <dt className="text-body-sm text-ink-500">Enabled (route gate)</dt>
          <dd className="text-body-sm text-ink-900">{card.enabled ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">Available (effective)</dt>
          {/* Three states, not two. An absent `available` reads as "Not
              published" rather than folding into "No": a backend that never
              answered the question and one that answered no have different
              remedies, and only the second is a statement about the bridge. */}
          <dd className="text-body-sm text-ink-900">
            {card.available === undefined
              ? "Not published"
              : card.available
                ? "Yes"
                : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">Route fee</dt>
          <dd className="text-body-sm text-ink-900 tabular">
            {card.feeBps === null ? "Not published" : formatBps(card.feeBps)}
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-ink-500">Per-transfer limits</dt>
          <dd className="text-body-sm text-ink-900 tabular">
            {card.minimum && card.maximum ? (
              <>
                <Figure figure={card.minimum} /> – <Figure figure={card.maximum} />
              </>
            ) : (
              <span className="text-ink-500">Not published</span>
            )}
          </dd>
        </div>
      </dl>
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
                  {/* Every availability kind has its own status
                      descriptor: "Not implemented" is neutral rather than
                      danger, because nothing is wrong and nothing is
                      waiting to be switched back on, and "Temporarily
                      unavailable" is warn rather than danger because the
                      route is switched on and its reserve will reopen. */}
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

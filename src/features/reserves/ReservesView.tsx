"use client";

import { useState } from "react";
import { History, TriangleAlert } from "lucide-react";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  TokenAmount,
} from "@/components/ui";
import { useChains, useReserve, useReserveHistory, useStats } from "@/lib/query/hooks";
import { directionAvailabilityStatus } from "@/lib/status";
import {
  GOLDCOIN_GLC,
  SOLANA_GLC,
  destinationReserveGroups,
  executableRoutes,
} from "@/lib/bridge";
import type { DestinationReserve } from "@/lib/bridge";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { cn } from "@/lib/utils/cn";
import type { ReserveHistoryEntryDto } from "@/lib/api/schemas/reserves";
import { reserveHistoryDirectionLabel } from "@/lib/api/schemas/reserves";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";
import { robinhoodReserveLedger } from "@/lib/api/schemas/stats";
import {
  ROBINHOOD_NOT_CONFIGURED,
  ROBINHOOD_UNAVAILABLE,
} from "@/lib/api/schemas/robinhood";
import { clampAtomicAtZero, isNegativeAtomic, toBigInt } from "@/lib/api/schemas/common";

const HISTORY_PAGE_SIZE = 20;

/**
 * Reserve capacity is a first-class concept for a reserve-backed bridge:
 * there is no supply-changing fallback mechanism, so a direction is only as
 * available as its destination reserve's capacity. Every figure here comes
 * from `GET /reserve` / `GET /stats` / `GET /reserves/history` — never
 * computed or guessed client-side, and never presented as unlimited.
 */
export function ReservesView() {
  const reserve = useReserve();
  const stats = useStats();
  const chains = useChains();

  if (reserve.isPending || stats.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (reserve.isError) return <ErrorState error={reserve.error} />;
  if (stats.isError) return <ErrorState error={stats.error} />;

  /*
   * Which executable routes each reserve actually backs, read off
   * `GET /chains` rather than named in the markup.
   *
   * The Goldcoin card used to say it backs "GLC on Solana -> GLC L1"
   * payouts, full stop. That was true while those were the only two routes
   * with settlement machinery; `RhnToGlc` settles onto the same pool, so
   * the sentence had quietly become a half-truth about which transfers a
   * shortfall here affects. Derived from the registry, a route the backend
   * opens later is named with no frontend deploy.
   */
  const backedBy = (target: DestinationReserve): string | null => {
    const group = destinationReserveGroups(executableRoutes(chains.data)).find(
      (entry) => entry.reserve === target,
    );
    if (!group) return null;
    return group.routes.map((route) => route.label).join(" · ");
  };

  // `capacity` is an exact atomic string; compared as a bigint so a value
  // beyond Number.MAX_SAFE_INTEGER is judged on its real magnitude.
  const availability = (capacity: string, paused: boolean) => {
    if (paused) return directionAvailabilityStatus.paused;
    if (toBigInt(capacity) <= 0n)
      return directionAvailabilityStatus["insufficient-liquidity"];
    return directionAvailabilityStatus.available;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card variant="raised">
          <div className="flex items-center justify-between">
            <h2 className="text-heading-3">Solana reserve</h2>
            <StatusBadge
              status={availability(
                reserve.data.solana_available_capacity,
                stats.data.solana_paused,
              )}
            />
          </div>
          <ReserveBackedBy routes={backedBy("solana")} />
          <div className="mt-4">
            <TokenAmount
              raw={clampAtomicAtZero(reserve.data.solana_available_capacity)}
              decimals={SOLANA_GLC.decimals}
              symbol={SOLANA_GLC.symbol}
              className="text-heading-2"
            />
            <p className="text-body-sm text-ink-500 mt-1">Available capacity</p>
          </div>
          {isNegativeAtomic(reserve.data.solana_available_capacity) && (
            <p className="text-body-sm text-danger-700 mt-2 flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              Reported capacity is negative — this reserve needs operator attention.
            </p>
          )}
        </Card>

        <Card variant="raised">
          <div className="flex items-center justify-between">
            <h2 className="text-heading-3">Goldcoin reserve</h2>
            <StatusBadge
              status={availability(
                reserve.data.goldcoin_available_capacity,
                stats.data.goldcoin_paused,
              )}
            />
          </div>
          <ReserveBackedBy routes={backedBy("goldcoin")} />
          <div className="mt-4">
            <TokenAmount
              raw={clampAtomicAtZero(reserve.data.goldcoin_available_capacity)}
              decimals={GOLDCOIN_GLC.decimals}
              symbol={GOLDCOIN_GLC.symbol}
              className="text-heading-2"
            />
            <p className="text-body-sm text-ink-500 mt-1">Available capacity</p>
          </div>
          {isNegativeAtomic(reserve.data.goldcoin_available_capacity) && (
            <p className="text-body-sm text-danger-700 mt-2 flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              Reported capacity is negative — this reserve needs operator attention.
            </p>
          )}
        </Card>

        <RobinhoodReserveCard stats={stats.data} routes={backedBy("robinhood")} />
      </div>

      <ReserveHistoryTable />
    </div>
  );
}

/**
 * The routes a reserve pays out of, or nothing at all while `/chains` is
 * still in flight. A guess at "the routes we know about" is exactly what
 * naming them in the markup already was.
 */
function ReserveBackedBy({ routes }: { routes: string | null }) {
  if (!routes) return null;
  return <p className="text-body-sm text-ink-600 mt-1">Backs {routes} payouts.</p>;
}

/**
 * The Robinhood reserve, from `GET /stats`' `robinhood_reserve` member.
 *
 * # Why `/stats` and not `GET /robinhood/reserve`
 *
 * This page already fetches `/stats` for the other two reserves' pause
 * flags, and `/stats` answers on every deployment. `/robinhood/reserve`
 * does not: a deployment predating it returns 404, which is why
 * `useRobinhoodReserve` is caller-gated on `/chains` everywhere else in
 * the app. Reading the member this page already has in hand keeps the
 * third card free of a fourth request that would fail on exactly the
 * deployments that have no Robinhood reserve to show.
 *
 * The two endpoints do not disagree: `ledger_availability` is the same
 * `crate::robinhood::public` verdict under the same field name, read with
 * the same fail-closed predicate.
 *
 * # Absent, unconfigured and empty are three different cards
 *
 * - Member absent — this backend does not publish the reserve at all. No
 *   card, exactly as before this member existed; there is nothing to
 *   report and an "Unknown" slot would report the API's age, not a
 *   reserve.
 * - `not_configured` / `unavailable` / any unknown spelling — the card
 *   renders, states which, and shows NO NUMBER. Not a zero: the backend
 *   sent `null`, and a zero would be this page inventing a balance on the
 *   one page whose whole premise is that it never does.
 * - `available` — real figures, formatted at the CANONICAL 8 decimals its
 *   ledger is kept in, never at the custody contract's native 18.
 */
function RobinhoodReserveCard({
  stats,
  routes,
}: {
  stats: BridgeStatsDto;
  routes: string | null;
}) {
  const member = stats.robinhood_reserve;
  if (!member) return null;

  const ledger = robinhoodReserveLedger(stats);

  return (
    <Card variant="raised">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-heading-3">Robinhood reserve</h2>
        <StatusBadge
          status={
            ledger === null
              ? directionAvailabilityStatus.unknown
              : ledger.paused === null
                ? directionAvailabilityStatus.degraded
                : ledger.paused
                  ? directionAvailabilityStatus.paused
                  : toBigInt(ledger.available_capacity) <= 0n
                    ? directionAvailabilityStatus["insufficient-liquidity"]
                    : directionAvailabilityStatus.available
          }
        />
      </div>
      <ReserveBackedBy routes={routes} />
      {ledger === null ? (
        <p className="text-body-sm text-ink-600 mt-4">
          {unconfiguredReason(member.ledger_availability)}
        </p>
      ) : (
        <>
          <div className="mt-4">
            <TokenAmount
              raw={clampAtomicAtZero(ledger.available_capacity)}
              decimals={GOLDCOIN_DECIMALS}
              symbol={GOLDCOIN_GLC.symbol}
              className="text-heading-2"
            />
            <p className="text-body-sm text-ink-500 mt-1">Available capacity</p>
          </div>
          {isNegativeAtomic(ledger.available_capacity) && (
            <p className="text-body-sm text-danger-700 mt-2 flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              Reported capacity is negative — this reserve needs operator attention.
            </p>
          )}
          {/*
            Settled volume and accrued fees are published for this reserve
            and for no other: `/stats`' Goldcoin and Solana members carry
            the same two figures, and the aggregate view on /explorer
            already shows their settled volume. Shown here rather than
            dropped, each omitted individually when the backend sent
            `null` for it — an absent figure is stated by its absence, not
            by a zero.
          */}
          <dl className="border-ink-100 mt-4 flex flex-col gap-1 border-t pt-3">
            {ledger.settled_volume_atomic !== null && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-body-sm text-ink-500">Settled volume</dt>
                <dd className="text-body-sm text-ink-700">
                  <TokenAmount
                    raw={ledger.settled_volume_atomic}
                    decimals={GOLDCOIN_DECIMALS}
                    symbol={GOLDCOIN_GLC.symbol}
                  />
                </dd>
              </div>
            )}
            {ledger.accrued_fees_atomic !== null && (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-body-sm text-ink-500">Accrued fees</dt>
                <dd className="text-body-sm text-ink-700">
                  <TokenAmount
                    raw={ledger.accrued_fees_atomic}
                    decimals={GOLDCOIN_DECIMALS}
                    symbol={GOLDCOIN_GLC.symbol}
                  />
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
    </Card>
  );
}

/**
 * Why there is no figure, in the backend's own terms. Every branch says
 * "we have no number", never "the number is zero".
 */
function unconfiguredReason(availability: string): string {
  if (availability === ROBINHOOD_NOT_CONFIGURED) {
    return "Not configured on this deployment — this bridge holds no Robinhood reserve, so there is no capacity to report.";
  }
  if (availability === ROBINHOOD_UNAVAILABLE) {
    return "Configured, but the bridge could not read this reserve just now. No capacity figure is available — this is not a balance of zero.";
  }
  // A verdict this build has never heard of. Named verbatim rather than
  // folded into either case above, both of which claim something specific.
  return `The bridge reported this reserve as "${availability}", which this page cannot interpret. No capacity figure is available.`;
}

function ReserveHistoryTable() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderPages, setOlderPages] = useState<readonly ReserveHistoryEntryDto[]>([]);

  const query = useReserveHistory({
    limit: HISTORY_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });

  const loadingMore = query.isPending && olderPages.length > 0;

  if (query.isPending && olderPages.length === 0) {
    return (
      <Card variant="raised">
        <h2 className="text-heading-3 mb-3">Reconciliation history</h2>
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  if (query.isError) return <ErrorState error={query.error} />;

  const items = query.isPending ? olderPages : [...olderPages, ...query.data.items];
  const nextCursor = query.isPending ? undefined : query.data.next_cursor;

  return (
    <Card variant="raised" padding="none" className="overflow-hidden">
      <h2 className="text-heading-3 px-6 pt-6">Reconciliation history</h2>
      <p className="text-body-sm text-ink-500 px-6 pt-1">
        Every scheduled reserve-balance check the bridge has actually recorded — a real,
        already-persisted observation, never interpolated.
      </p>
      {items.length === 0 ? (
        <EmptyState
          icon={History}
          title="No reconciliation ticks yet"
          description="This reserve has no recorded history yet."
          className="px-6 py-10"
        />
      ) : (
        <>
          <ReserveHistoryRows items={items} />
          {(nextCursor || loadingMore) && (
            <div className="border-ink-100 flex justify-center border-t p-4">
              <Button
                variant="secondary"
                size="sm"
                loading={loadingMore}
                onClick={() => {
                  setOlderPages(items);
                  setCursor(nextCursor ?? null);
                }}
              >
                Load older history
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ReserveHistoryRows({ items }: { items: readonly ReserveHistoryEntryDto[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="border-ink-100 bg-ink-50 text-body-sm text-ink-500 border-y">
            <th className="py-2.5 pr-4 pl-6 font-medium">Reserve</th>
            <th className="py-2.5 pr-4 font-medium">Detected</th>
            <th className="py-2.5 pr-4 font-medium">Delta (atomic)</th>
            <th className="py-2.5 pr-6 font-medium">Classification</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => {
            const skipped = entry.classification.startsWith("SKIPPED");
            return (
              <tr
                key={entry.id}
                className="border-ink-100 hover:bg-ink-50/60 border-b last:border-b-0"
              >
                <td className="text-body-sm py-2.5 pr-4 pl-6">
                  {/*
                    Named from the row's own spelling. The ternary this
                    replaced had no third branch, so a `RobinhoodReserve`
                    tick would have been labelled "Solana" — a wrong
                    reserve attached to a real discrepancy.
                  */}
                  {reserveHistoryDirectionLabel(entry.direction)}
                </td>
                <td className="text-body-sm text-ink-500 py-2.5 pr-4">
                  {new Date(entry.detected_at * 1000).toLocaleString()}
                </td>
                <td
                  className={cn(
                    "tabular text-body-sm py-2.5 pr-4",
                    isNegativeAtomic(entry.delta_atomic)
                      ? "text-danger-700"
                      : "text-ink-700",
                  )}
                >
                  {toBigInt(entry.delta_atomic) > 0n ? "+" : ""}
                  {entry.delta_atomic}
                </td>
                <td className="text-body-sm py-2.5 pr-6">
                  {skipped ? (
                    <span className="text-warn-700">
                      missing tick — {entry.classification}
                    </span>
                  ) : (
                    // Case/underscore formatting only — the value itself is
                    // the backend's real classification, kept verbatim in
                    // the title attribute.
                    <span className="text-ink-700" title={entry.classification}>
                      {humanizeClassification(entry.classification)}
                    </span>
                  )}
                  {entry.auto_paused && (
                    <span className="text-danger-700 bg-danger-50 ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
                      <TriangleAlert aria-hidden="true" className="size-3" />
                      Auto-paused
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "WITHIN_TOLERANCE" -> "Within tolerance". Formatting only, never data. */
function humanizeClassification(value: string): string {
  const lowered = value.replace(/_/g, " ").toLowerCase();
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

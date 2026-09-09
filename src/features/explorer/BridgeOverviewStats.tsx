"use client";

import type { ReactNode } from "react";
import { ArrowRightLeft, Clock, ShieldAlert } from "lucide-react";
import { Card, Skeleton, TokenAmount } from "@/components/ui";
import { useChains, useStats } from "@/lib/query/hooks";
import {
  destinationReserveGroups,
  directions,
  displayDescriptorFor,
  executableRoutes,
  GOLDCOIN_GLC,
  SOLANA_GLC,
} from "@/lib/bridge";
import type { DestinationReserve } from "@/lib/bridge";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";

function Stat({
  label,
  detail,
  icon: Icon,
  children,
}: {
  label: string;
  /** A second line under the term, for scope the label cannot carry. */
  detail?: ReactNode;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  children: ReactNode;
}) {
  return (
    <Card padding="sm">
      <dt className="text-body-sm text-ink-500">
        <span className="flex items-center gap-1.5">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          {label}
        </span>
        {/*
          The same `text-ink-500` as the label above it, not a step
          quieter. `ink-400` on `surface-raised` is 2.75:1 in the dark
          theme — below AA, and this line carries which route families a
          figure covers, which is load-bearing rather than decorative.
        */}
        {detail && <span className="mt-0.5 block">{detail}</span>}
      </dt>
      <dd className="text-heading-2 text-ink-950 mt-1.5">{children}</dd>
    </Card>
  );
}

/**
 * Where a settled-volume figure for one reserve comes from.
 *
 * `GET /stats` publishes `settled_volume_atomic` for the Goldcoin and
 * Solana reserves, each in that reserve's own native destination unit
 * (docs/05-reserve-accounting.md) — so the decimals belong to the reserve,
 * not to a single global token constant.
 *
 * The Robinhood reserve is `null` here, and that is a statement about the
 * API rather than about the reserve: `GET /robinhood/reserve` publishes a
 * balance, a protected minimum, reserved liquidity, pending obligations,
 * capacity and accrued fees — but no cumulative settled-volume counter, and
 * `GET /stats` has no `robinhood_reserve` member at all. Nothing in this
 * app may stand in for it. Summing what /stats does publish, or deriving a
 * figure from capacity movement, would produce a number the bridge has
 * never asserted, on the one page whose entire premise is that every figure
 * is one it has.
 */
const SETTLED_VOLUME: Record<
  DestinationReserve,
  (stats: BridgeStatsDto) => { atomic: string; decimals: number } | null
> = {
  goldcoin: (stats) => ({
    atomic: stats.goldcoin_reserve.settled_volume_atomic,
    decimals: GOLDCOIN_GLC.decimals,
  }),
  solana: (stats) => ({
    atomic: stats.solana_reserve.settled_volume_atomic,
    decimals: SOLANA_GLC.decimals,
  }),
  robinhood: () => null,
};

/**
 * The routes `GET /stats` publishes a per-direction request COUNT for.
 *
 * `BridgeStats` carries exactly two `DirectionStats` members, named
 * `glc_to_sol` and `sol_to_glc`. This is not a UI policy about which routes
 * matter — it is the shape of the DTO, which is why the map is keyed by the
 * field that exists rather than by a list of routes this build likes. A
 * Robinhood transfer is counted in neither, so the cards built from these
 * say whose counts they are instead of implying they cover the bridge.
 */
const DIRECTION_STATS: Partial<
  Record<SettlementRoute, (stats: BridgeStatsDto) => BridgeStatsDto["glc_to_sol"]>
> = {
  GlcToSol: (stats) => stats.glc_to_sol,
  SolToGlc: (stats) => stats.sol_to_glc,
};

/**
 * Aggregate bridge statistics from `GET /stats`. Every figure here is
 * backend-authoritative; nothing is derived or estimated on the client.
 *
 * # Why the route families come from `GET /chains`
 *
 * This used to name `GlcToSol` and `SolToGlc` in the markup and read
 * `solana_reserve`/`goldcoin_reserve` straight off the response. That was
 * correct only while those were the only two routes with settlement
 * machinery: the moment `RhnToGlc` also settles onto the Goldcoin reserve,
 * the card labelled "Solana → Goldcoin settled" is showing a counter that
 * includes Robinhood volume too.
 *
 * So the families are read from `/chains`' `implemented` flag and grouped
 * by the reserve they settle onto — which is the granularity `/stats`
 * actually publishes. `SolToRhn`/`RhnToSol` are excluded by the same flag,
 * permanently: the backend reports them `implemented: false` because
 * neither has a `Direction` value, so no settlement function can be called
 * with them and no volume can ever accrue to either.
 *
 * # Degradation
 *
 * Route families are unknown until `/chains` answers, and unknown is
 * rendered as nothing rather than as a local guess at "the routes we know
 * about" — the guess is exactly the hardcoding this removed. React Query
 * keeps the last good response through a refetch failure, so only a
 * cold-start failure of `/chains` leaves the settled cards absent; the
 * request counters below them, which need no route list, still render.
 */
export function BridgeOverviewStats() {
  const query = useStats();
  const chains = useChains();

  if (query.isPending || chains.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) return null;

  const stats = query.data;
  const executable = executableRoutes(chains.data);
  const groups = destinationReserveGroups(executable);

  // Which executable families the request counters below actually cover,
  // and which they silently would not. Derived from the DTO's own members,
  // so a backend that starts publishing Robinhood counts needs no change
  // here beyond adding them to `DIRECTION_STATS`.
  const counted = executable.filter((route) => DIRECTION_STATS[route]);
  const uncounted = executable.filter((route) => !DIRECTION_STATS[route]);
  const countScope =
    uncounted.length > 0
      ? `Counted for ${counted.map((route) => directions[route].label).join(", ")} only`
      : undefined;

  const sumOver = (field: "in_progress_requests" | "manual_review_requests") =>
    counted.reduce((total, route) => total + DIRECTION_STATS[route]!(stats)[field], 0);

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {groups.map((group) => {
        const volume = SETTLED_VOLUME[group.reserve](stats);
        return (
          <Stat
            key={group.reserve}
            label={`Settled into ${displayDescriptorFor(group.reserve).name}`}
            // Every executable family feeding this reserve, named. With
            // more than one, the figure above is genuinely their combined
            // total — `settled_volume_atomic` is a per-reserve counter —
            // and listing them is what keeps that from reading as one
            // route's volume.
            detail={group.routes.map((route) => route.label).join(" · ")}
            icon={ArrowRightLeft}
          >
            {volume ? (
              <TokenAmount raw={volume.atomic} decimals={volume.decimals} symbol="GLC" />
            ) : (
              <span className="text-ink-500">Not published</span>
            )}
          </Stat>
        );
      })}
      <Stat label="In-flight transfers" detail={countScope} icon={Clock}>
        {sumOver("in_progress_requests")}
      </Stat>
      <Stat label="Manual review" detail={countScope} icon={ShieldAlert}>
        {sumOver("manual_review_requests")}
      </Stat>
    </dl>
  );
}

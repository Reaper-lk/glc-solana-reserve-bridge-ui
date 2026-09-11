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
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import type { SettlementRoute } from "@/lib/api/schemas/common";
import type { BridgeStatsDto } from "@/lib/api/schemas/stats";
import { robinhoodReserveLedger } from "@/lib/api/schemas/stats";

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
 * The Robinhood reserve publishes one too, as of backend PR #79:
 * `/stats`' `robinhood_reserve.settled_volume_atomic`, in the CANONICAL 8
 * decimals that reserve's ledger is kept in — deliberately not the custody
 * contract's native 18, which `GET /robinhood/reserve`'s `onchain` figures
 * use. (`GET /robinhood/reserve` itself still has no cumulative counter;
 * this is the member that added one.)
 *
 * It is `null` in every case in which the backend declined to state the
 * figure — member absent, ledger `not_configured` or `unavailable`, or the
 * counter itself `null` — and nothing in this app may stand in for it
 * there. Summing what /stats does publish, deriving a figure from capacity
 * movement, or reading the rolling-24h window (which measures headroom
 * remaining, not volume settled) would each produce a number the bridge
 * has never asserted, on the one page whose entire premise is that every
 * figure is one it has.
 *
 * A reserve that returns `null` gets NO CARD. It previously got one
 * reading "Not published", which put a permanent unfinished-looking slot
 * in the grid to report the absence of a metric a reader never asked
 * after — and invited exactly the "just fill it in from somewhere" fix
 * this map exists to prevent.
 */
interface SettledVolume {
  readonly atomic: string;
  readonly decimals: number;
}

const SETTLED_VOLUME: Record<
  DestinationReserve,
  (stats: BridgeStatsDto) => SettledVolume | null
> = {
  goldcoin: (stats) => ({
    atomic: stats.goldcoin_reserve.settled_volume_atomic,
    decimals: GOLDCOIN_GLC.decimals,
  }),
  solana: (stats) => ({
    atomic: stats.solana_reserve.settled_volume_atomic,
    decimals: SOLANA_GLC.decimals,
  }),
  robinhood: (stats) => {
    const ledger = robinhoodReserveLedger(stats);
    if (!ledger || ledger.settled_volume_atomic === null) return null;
    return { atomic: ledger.settled_volume_atomic, decimals: GOLDCOIN_DECIMALS };
  },
};

/**
 * The routes `GET /stats` publishes a per-direction request COUNT for.
 *
 * `BridgeStats` carries exactly two `DirectionStats` members, named
 * `glc_to_sol` and `sol_to_glc`. This is not a UI policy about which routes
 * matter — it is the shape of the DTO, which is why the map is keyed by the
 * field that exists rather than by a list of routes this build likes. None
 * of the four Robinhood-legged routes is counted in either, so the cards
 * built from these say whose counts they are instead of implying they cover
 * the bridge.
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
 * actually publishes. All six routes now report implemented, so all six are
 * grouped: two per reserve, three counters. Reading the flag rather than
 * naming routes is why that needed no change here.
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

  // Only the reserves `/stats` actually publishes a counter for. The rest
  // are dropped here rather than rendered as an empty slot.
  const settled = groups
    .map((group) => ({ group, volume: SETTLED_VOLUME[group.reserve](stats) }))
    .filter(
      (entry): entry is { group: (typeof groups)[number]; volume: SettledVolume } =>
        entry.volume !== null,
    );

  return (
    /*
      Column count follows the card count, so dropping an unpublished
      figure leaves a full row rather than a gap where it used to be: four
      cards land 2×2 and then 4×1, five fill three columns and spill two.
    */
    <dl
      className={`grid grid-cols-2 gap-3 ${
        settled.length + 2 === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3"
      }`}
    >
      {settled.map(({ group, volume }) => (
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
          <TokenAmount raw={volume.atomic} decimals={volume.decimals} symbol="GLC" />
        </Stat>
      ))}
      <Stat label="In-flight transfers" detail={countScope} icon={Clock}>
        {sumOver("in_progress_requests")}
      </Stat>
      <Stat label="Manual review" detail={countScope} icon={ShieldAlert}>
        {sumOver("manual_review_requests")}
      </Stat>
    </dl>
  );
}

"use client";

import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import { useBridgeStatus, useChains, useHealth, useReserve } from "@/lib/query/hooks";
import { directionAvailabilityStatus, systemStatus } from "@/lib/status";
import type { DirectionAvailability } from "@/lib/status";
import {
  directionGateState,
  directions,
  findRouteView,
  GOLDCOIN_GLC,
  SOLANA_GLC,
} from "@/lib/bridge";
import type { DirectionGateState } from "@/lib/bridge";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";
import type { Direction } from "@/lib/api/schemas/common";

export function StatusView() {
  const status = useBridgeStatus();
  const health = useHealth();
  const reserve = useReserve();
  // Route availability is the server's verdict, same as in the bridge form —
  // this screen must never report a route as available on its own authority.
  const chains = useChains();

  if (status.isPending || health.isPending || reserve.isPending || chains.isPending) {
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
    // A route the server has not opened is not "paused" and has no reserve
    // to be constrained — it is simply unavailable.
    "route-disabled": "paused",
  };
  const availability = (direction: Direction) =>
    directionAvailabilityStatus[
      GATE_TO_BADGE[
        directionGateState(data, direction, findRouteView(chains.data?.routes, direction))
      ]
    ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DirectionStatusCard
          title={directions.GlcToSol.label}
          status={availability("GlcToSol")}
          capacityRaw={String(Math.max(reserve.data.solana_available_capacity, 0))}
          token={SOLANA_GLC}
          statusData={data}
          direction="GlcToSol"
        />
        <DirectionStatusCard
          title={directions.SolToGlc.label}
          status={availability("SolToGlc")}
          capacityRaw={String(Math.max(reserve.data.goldcoin_available_capacity, 0))}
          token={GOLDCOIN_GLC}
          statusData={data}
          direction="SolToGlc"
        />
      </div>

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

function DirectionStatusCard({
  title,
  status,
  capacityRaw,
  token,
  statusData,
  direction,
}: {
  title: string;
  status: (typeof directionAvailabilityStatus)[keyof typeof directionAvailabilityStatus];
  capacityRaw: string;
  token: { decimals: number; symbol: string };
  statusData: BridgeStatusDto;
  direction: Direction;
}) {
  // Quota fields are mint-atomic (6 decimals) — see schemas/status.ts.
  const remaining =
    direction === "GlcToSol"
      ? statusData.glc_to_sol_rolling_volume_remaining
      : statusData.sol_to_glc_rolling_volume_remaining;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity aria-hidden="true" className="text-ink-400 size-4 shrink-0" />
          <h2 className="text-heading-3">{title}</h2>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="mt-3">
        <TokenAmount
          raw={capacityRaw}
          decimals={token.decimals}
          symbol={token.symbol}
          className="text-heading-2"
        />
        <p className="text-body-sm text-ink-500 mt-1">Destination reserve capacity</p>
      </div>
      <div className="mt-2">
        <TokenAmount
          raw={String(remaining)}
          decimals={SOLANA_GLC.decimals}
          symbol="GLC"
        />
        <p className="text-body-sm text-ink-500 mt-1">
          Remaining 24-hour capacity for this direction
        </p>
      </div>
    </Card>
  );
}

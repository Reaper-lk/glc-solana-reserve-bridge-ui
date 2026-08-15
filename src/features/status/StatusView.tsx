"use client";

import { Activity, HeartPulse } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import { useBridgeStatus, useHealth, useReserve } from "@/lib/query/hooks";
import { directionAvailabilityStatus, systemStatus } from "@/lib/status";
import { directions, GOLDCOIN_GLC, SOLANA_GLC } from "@/lib/bridge";

export function StatusView() {
  const status = useBridgeStatus();
  const health = useHealth();
  const reserve = useReserve();

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

  const availability = (available: boolean, paused: boolean) =>
    paused
      ? directionAvailabilityStatus.paused
      : available
        ? directionAvailabilityStatus.available
        : directionAvailabilityStatus["insufficient-liquidity"];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DirectionStatusCard
          title={directions.GlcToSol.label}
          status={availability(data.glc_to_sol_available, data.solana_paused)}
          capacityRaw={String(Math.max(reserve.data.solana_available_capacity, 0))}
          token={SOLANA_GLC}
        />
        <DirectionStatusCard
          title={directions.SolToGlc.label}
          status={availability(data.sol_to_glc_available, data.goldcoin_paused)}
          capacityRaw={String(Math.max(reserve.data.goldcoin_available_capacity, 0))}
          token={GOLDCOIN_GLC}
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
}: {
  title: string;
  status: (typeof directionAvailabilityStatus)[keyof typeof directionAvailabilityStatus];
  capacityRaw: string;
  token: { decimals: number; symbol: string };
}) {
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
    </Card>
  );
}

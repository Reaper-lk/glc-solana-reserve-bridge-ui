"use client";

import { Card, ErrorState, Skeleton, StatusBadge } from "@/components/ui";
import { useBridgeStatus, useHealth } from "@/lib/query/hooks";
import { directionAvailabilityStatus, systemStatus } from "@/lib/status";

export function StatusView() {
  const status = useBridgeStatus();
  const health = useHealth();

  if (status.isPending || health.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (status.isError) return <ErrorState error={status.error} />;
  if (health.isError) return <ErrorState error={health.error} />;

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
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-heading-3">Goldcoin → Solana</h2>
            <StatusBadge
              status={availability(data.glc_to_sol_available, data.solana_paused)}
            />
          </div>
        </Card>
        <Card>
          <div className="flex items-center justify-between">
            <h2 className="text-heading-3">Solana → Goldcoin</h2>
            <StatusBadge
              status={availability(data.sol_to_glc_available, data.goldcoin_paused)}
            />
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="text-heading-3 mb-3">System health</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-body-sm text-ink-500">Overall</dt>
            <dd>
              <StatusBadge
                status={h.healthy ? systemStatus.operational : systemStatus.degraded}
                size="sm"
              />
            </dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Goldcoin indexer</dt>
            <dd>
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
            <dd className="tabular">{h.manual_review_backlog}</dd>
          </div>
          <div>
            <dt className="text-body-sm text-ink-500">Reorg events</dt>
            <dd className="tabular">{h.post_finality_reorg_events}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

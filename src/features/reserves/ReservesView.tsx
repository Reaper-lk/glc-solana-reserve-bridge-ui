"use client";

import { TriangleAlert } from "lucide-react";
import { Card, ErrorState, Skeleton, StatusBadge, TokenAmount } from "@/components/ui";
import { useReserve, useReserveHistory, useStats } from "@/lib/query/hooks";
import { directionAvailabilityStatus } from "@/lib/status";
import { GOLDCOIN_GLC, SOLANA_GLC } from "@/lib/bridge";

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

  if (reserve.isPending || stats.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (reserve.isError) return <ErrorState error={reserve.error} />;
  if (stats.isError) return <ErrorState error={stats.error} />;

  const availability = (capacity: number, paused: boolean) => {
    if (paused) return directionAvailabilityStatus.paused;
    if (capacity <= 0) return directionAvailabilityStatus["insufficient-liquidity"];
    return directionAvailabilityStatus.available;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-heading-3">Solana reserve</h3>
            <StatusBadge
              status={availability(
                reserve.data.solana_available_capacity,
                stats.data.solana_paused,
              )}
            />
          </div>
          <p className="text-body-sm text-ink-600 mt-1">
            Backs Goldcoin → Solana payouts.
          </p>
          <div className="mt-4">
            <TokenAmount
              raw={String(Math.max(reserve.data.solana_available_capacity, 0))}
              decimals={SOLANA_GLC.decimals}
              symbol={SOLANA_GLC.symbol}
              className="text-heading-2"
            />
            <p className="text-body-sm text-ink-500 mt-1">Available capacity</p>
          </div>
          {reserve.data.solana_available_capacity < 0 && (
            <p className="text-body-sm text-danger-700 mt-2 flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              Reported capacity is negative — this reserve needs operator attention.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-heading-3">Goldcoin reserve</h3>
            <StatusBadge
              status={availability(
                reserve.data.goldcoin_available_capacity,
                stats.data.goldcoin_paused,
              )}
            />
          </div>
          <p className="text-body-sm text-ink-600 mt-1">
            Backs Solana → Goldcoin payouts.
          </p>
          <div className="mt-4">
            <TokenAmount
              raw={String(Math.max(reserve.data.goldcoin_available_capacity, 0))}
              decimals={GOLDCOIN_GLC.decimals}
              symbol={GOLDCOIN_GLC.symbol}
              className="text-heading-2"
            />
            <p className="text-body-sm text-ink-500 mt-1">Available capacity</p>
          </div>
          {reserve.data.goldcoin_available_capacity < 0 && (
            <p className="text-body-sm text-danger-700 mt-2 flex items-center gap-1.5">
              <TriangleAlert aria-hidden="true" className="size-4" />
              Reported capacity is negative — this reserve needs operator attention.
            </p>
          )}
        </Card>
      </div>

      <ReserveHistoryTable />
    </div>
  );
}

function ReserveHistoryTable() {
  const query = useReserveHistory({ limit: 20 });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) return <ErrorState error={query.error} />;
  if (query.data.items.length === 0) return null;

  return (
    <div>
      <h3 className="text-heading-3 mb-2">Reconciliation history</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-ink-100 text-body-sm text-ink-500 border-b">
              <th className="py-2 pr-4 font-medium">Reserve</th>
              <th className="py-2 pr-4 font-medium">Detected</th>
              <th className="py-2 pr-4 font-medium">Delta (atomic)</th>
              <th className="py-2 pr-4 font-medium">Classification</th>
            </tr>
          </thead>
          <tbody>
            {query.data.items.map((entry) => {
              const skipped = entry.classification.startsWith("SKIPPED");
              return (
                <tr key={entry.id} className="border-ink-100 border-b last:border-b-0">
                  <td className="text-body-sm py-2 pr-4">{entry.direction}</td>
                  <td className="text-body-sm text-ink-500 py-2 pr-4">
                    {new Date(entry.detected_at * 1000).toLocaleString()}
                  </td>
                  <td className="tabular text-body-sm py-2 pr-4">{entry.delta_atomic}</td>
                  <td className="text-body-sm py-2 pr-4">
                    {skipped ? (
                      <span className="text-warn-700">
                        missing tick — {entry.classification}
                      </span>
                    ) : (
                      entry.classification
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
import { useReserve, useReserveHistory, useStats } from "@/lib/query/hooks";
import { directionAvailabilityStatus } from "@/lib/status";
import { GOLDCOIN_GLC, SOLANA_GLC, directions } from "@/lib/bridge";
import { cn } from "@/lib/utils/cn";
import type { ReserveHistoryEntryDto } from "@/lib/api/schemas/reserves";

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
        <Card variant="raised">
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
            Backs {directions.GlcToSol.label} payouts.
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

        <Card variant="raised">
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
            Backs {directions.SolToGlc.label} payouts.
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
        <h3 className="text-heading-3 mb-3">Reconciliation history</h3>
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  if (query.isError) return <ErrorState error={query.error} />;

  const items = query.isPending ? olderPages : [...olderPages, ...query.data.items];
  const nextCursor = query.isPending ? undefined : query.data.next_cursor;

  return (
    <Card variant="raised" padding="none" className="overflow-hidden">
      <h3 className="text-heading-3 px-6 pt-6">Reconciliation history</h3>
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
            <div className="flex justify-center border-ink-100 border-t p-4">
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
                  {entry.direction === "GoldcoinReserve" ? "Goldcoin" : "Solana"}
                </td>
                <td className="text-body-sm text-ink-500 py-2.5 pr-4">
                  {new Date(entry.detected_at * 1000).toLocaleString()}
                </td>
                <td
                  className={cn(
                    "tabular text-body-sm py-2.5 pr-4",
                    entry.delta_atomic < 0 ? "text-danger-700" : "text-ink-700",
                  )}
                >
                  {entry.delta_atomic > 0 ? "+" : ""}
                  {entry.delta_atomic}
                </td>
                <td className="text-body-sm py-2.5 pr-6">
                  {skipped ? (
                    <span className="text-warn-700">
                      missing tick — {entry.classification}
                    </span>
                  ) : (
                    <span className="text-ink-700">{entry.classification}</span>
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

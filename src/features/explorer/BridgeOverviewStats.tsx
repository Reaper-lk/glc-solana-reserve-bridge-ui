"use client";

import type { ReactNode } from "react";
import { ArrowRightLeft, Clock, ShieldAlert } from "lucide-react";
import { Card, Skeleton, TokenAmount } from "@/components/ui";
import { useStats } from "@/lib/query/hooks";
import { GOLDCOIN_GLC, SOLANA_GLC, directions } from "@/lib/bridge";

function Stat({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  children: ReactNode;
}) {
  return (
    <Card padding="sm">
      <dt className="text-body-sm text-ink-500 flex items-center gap-1.5">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="text-heading-2 text-ink-950 mt-1.5">{children}</dd>
    </Card>
  );
}

/**
 * Aggregate bridge statistics from `GET /stats`. Every figure here is
 * backend-authoritative; nothing is derived or estimated on the client.
 */
export function BridgeOverviewStats() {
  const query = useStats();

  if (query.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) return null;

  const stats = query.data;

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label={`${directions.GlcToSol.label} settled`} icon={ArrowRightLeft}>
        <TokenAmount
          raw={String(stats.solana_reserve.settled_volume_atomic)}
          decimals={SOLANA_GLC.decimals}
          symbol={SOLANA_GLC.symbol}
        />
      </Stat>
      <Stat label={`${directions.SolToGlc.label} settled`} icon={ArrowRightLeft}>
        <TokenAmount
          raw={String(stats.goldcoin_reserve.settled_volume_atomic)}
          decimals={GOLDCOIN_GLC.decimals}
          symbol={GOLDCOIN_GLC.symbol}
        />
      </Stat>
      <Stat label="In-flight transfers" icon={Clock}>
        {stats.glc_to_sol.in_progress_requests + stats.sol_to_glc.in_progress_requests}
      </Stat>
      <Stat label="Manual review" icon={ShieldAlert}>
        {stats.glc_to_sol.manual_review_requests +
          stats.sol_to_glc.manual_review_requests}
      </Stat>
    </dl>
  );
}

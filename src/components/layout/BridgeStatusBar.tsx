"use client";

import Link from "next/link";
import { toneStyles, systemStatus, type SystemStatus } from "@/lib/status";
import { useBridgeStatus } from "@/lib/query/hooks";
import { routes } from "@/lib/config/links";
import { StatusDot } from "@/components/ui/StatusDot";
import { cn } from "@/lib/utils/cn";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * The global trust strip.
 *
 * Present on every page so a user learns a direction is paused BEFORE they
 * commit funds, not after. Renders on the server with a hydrated snapshot so
 * the strip is correct on first paint. While a refresh is in flight the
 * previous values stay on screen — this bar never blanks to a skeleton.
 */
export function BridgeStatusBar({ initialStatus }: { initialStatus?: BridgeStatusDto }) {
  const { data, isPending, isError } = useBridgeStatus(initialStatus);

  if (isPending) {
    return <div className="border-ink-200 bg-ink-50 h-10 border-b" aria-hidden="true" />;
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (isError || !data) {
    return (
      <div className="border-ink-200 bg-ink-50 border-b">
        <div className="max-w-page mx-auto flex h-10 items-center gap-2 px-4 md:px-6">
          <StatusDot status={systemStatus.maintenance} />
          <p className="text-body-sm text-ink-700">
            Bridge status unavailable — we could not reach the bridge. Your funds are
            unaffected.
          </p>
          <Link
            href={routes.status}
            className="text-body-sm text-ink-700 ml-auto shrink-0 underline underline-offset-2"
          >
            View status
          </Link>
        </div>
      </div>
    );
  }

  const bothPaused = data.goldcoin_paused && data.solana_paused;
  const bothAvailable = data.glc_to_sol_available && data.sol_to_glc_available;
  const status: SystemStatus = bothPaused
    ? "paused"
    : bothAvailable
      ? "operational"
      : "degraded";
  const descriptor = systemStatus[status];
  const tone = toneStyles[descriptor.tone];

  return (
    <div className={cn("border-b", tone.bar)}>
      <div className="max-w-page mx-auto flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6 md:py-0">
        <StatusDot status={descriptor} showLabel live={status === "operational"} />

        <p className="text-body-sm text-ink-700">
          {status === "operational" && "Both directions are available."}
          {status === "degraded" &&
            (!data.glc_to_sol_available
              ? "Goldcoin → Solana is currently unavailable."
              : "Solana → Goldcoin is currently unavailable.")}
          {status === "paused" && "The bridge is paused on both sides."}
        </p>

        <Link
          href={routes.status}
          className="text-body-sm text-ink-700 hover:text-ink-950 ml-auto shrink-0 underline underline-offset-2"
        >
          View status
        </Link>
      </div>
    </div>
  );
}

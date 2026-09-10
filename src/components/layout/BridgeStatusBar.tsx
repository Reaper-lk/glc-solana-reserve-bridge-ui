"use client";

import Link from "next/link";
import { toneStyles, systemStatus, type SystemStatus } from "@/lib/status";
import { useBridgeStatus, useChains } from "@/lib/query/hooks";
import { routes } from "@/lib/config/links";
import { StatusDot } from "@/components/ui/StatusDot";
import { cn } from "@/lib/utils/cn";
import { systemRouteAvailability, systemRouteMessage } from "@/lib/bridge";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * The global trust strip.
 *
 * Present on every page so a user learns a route cannot be used BEFORE
 * they commit funds, not after. Renders on the server with a hydrated
 * snapshot so the strip is correct on first paint. While a refresh is in
 * flight the previous values stay on screen — this bar never blanks to a
 * skeleton.
 *
 * # Route-aware, not side-aware
 *
 * The tone and the sentence both come from `GET /chains` — how many
 * EXECUTABLE routes the backend positively reports `available: true` for,
 * and, for the rest, whether each is switched OFF (`enabled: false`) or
 * merely gated shut right now. They used to come from `GET /status`'s
 * `goldcoin_paused` / `solana_paused` pair, which described a
 * two-direction Solana bridge: with four executable routes across three
 * reserves, "the bridge is paused on both sides" names a topology that no
 * longer exists, and the two booleans behind it cannot see a Robinhood
 * route at all.
 *
 * The disabled/temporary split is `@/lib/bridge/system-banner`'s, and it
 * matters here because "temporarily unavailable" promises a self-healing
 * that a switched-off route will never do on its own.
 *
 * The strip never states a REASON. The backend publishes a cause-agnostic
 * `unavailable_reason` per route and there can be several distinct ones at
 * once; folding them into one line would either truncate them or present
 * one route's reason as the bridge's. /status renders each route's own
 * reason beside it, and this links there.
 */
export function BridgeStatusBar({ initialStatus }: { initialStatus?: BridgeStatusDto }) {
  const { data, isPending, isError } = useBridgeStatus(initialStatus);
  // Route availability is a separate endpoint from the status snapshot and
  // is NOT fetched server-side, so it can legitimately be absent for the
  // first moment of a visit — see the `unknown` copy below.
  const chains = useChains();

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

  const availability = systemRouteAvailability(chains.data);

  /*
   * `paused` for a bridge with nothing usable, `degraded` for any partial
   * state — a route switched off and a route gated shut are different
   * facts, said differently in the sentence below, but they are the same
   * amber to a reader deciding whether to start a transfer. `operational`
   * only when every executable route is available; `maintenance` while
   * `/chains` has not answered, so the strip fails closed to "we do not
   * know yet" rather than implying a count.
   */
  const status: SystemStatus =
    availability.kind === "none-available"
      ? "paused"
      : availability.kind === "all-available"
        ? "operational"
        : availability.kind === "unknown"
          ? "maintenance"
          : "degraded";
  const descriptor = systemStatus[status];
  const tone = toneStyles[descriptor.tone];

  /*
   * The operational sentence counts routes instead of naming two of them.
   * It used to read "Both directions are available.", which stopped being
   * true the moment `GET /chains` began listing six routes with four of
   * them closed — and no count is hardcoded here, so a route the backend
   * opens later is reflected without a frontend deploy.
   */
  const notice = systemRouteMessage(availability);
  const sentence =
    availability.kind === "all-available"
      ? `${availability.available} of ${availability.total} ${availability.total === 1 ? "route" : "routes"} available.`
      : notice;

  return (
    <div className={cn("border-b", tone.bar)}>
      <div className="max-w-page mx-auto flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6 md:py-0">
        <StatusDot status={descriptor} showLabel live={status === "operational"} />

        <p className="text-body-sm text-ink-700">{sentence}</p>

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

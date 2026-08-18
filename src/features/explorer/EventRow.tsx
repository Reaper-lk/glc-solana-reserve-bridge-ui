import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { requestStateStatus } from "@/lib/status";
import { directions } from "@/lib/bridge";
import type { ExplorerEventDto } from "@/lib/api/schemas/explorer";

/**
 * One real state transition. Deliberately carries no counterparty address
 * or operator identity — the backend never sends one for this endpoint
 * (`GET /explorer/events` module doc, service/src/api.rs) and this
 * component has nothing to render even if it wanted to.
 */
export function EventRow({ event }: { event: ExplorerEventDto }) {
  const descriptor = directions[event.direction];
  const at = new Date(event.at * 1000);

  return (
    <Link
      href={`/bridge/${event.request_id}`}
      className="border-ink-100 hover:bg-ink-50 focus-visible:bg-ink-50 flex flex-col gap-1 border-b px-4 py-3 outline-none last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-body-sm text-ink-700 flex items-center gap-2">
        <span>{descriptor.label}</span>
        <span className="text-ink-500">#{event.request_id}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {event.from_state && (
          <>
            <StatusBadge status={requestStateStatus[event.from_state]} size="sm" />
            <ArrowRight aria-hidden="true" className="text-ink-400 size-3.5" />
          </>
        )}
        <StatusBadge status={requestStateStatus[event.to_state]} size="sm" />
        <time dateTime={at.toISOString()} className="text-body-sm text-ink-500">
          {at.toLocaleString()}
        </time>
      </div>
    </Link>
  );
}

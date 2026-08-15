"use client";

import { Radio } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useExplorerEvents } from "@/lib/query/hooks";
import { EventRow } from "./EventRow";

export function ExplorerFeed() {
  const query = useExplorerEvents({ limit: 30 });

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (query.isError) return <ErrorState error={query.error} />;

  if (query.data.items.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="No events yet"
        description="Nothing has happened on the bridge yet."
      />
    );
  }

  return (
    <div className="border-ink-100 divide-ink-100 divide-y rounded-lg border">
      {query.data.items.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </div>
  );
}

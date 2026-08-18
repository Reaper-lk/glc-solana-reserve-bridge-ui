"use client";

import { useState } from "react";
import { Radio } from "lucide-react";
import { Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useExplorerEvents } from "@/lib/query/hooks";
import { EventRow } from "./EventRow";
import type { ExplorerEventDto } from "@/lib/api/schemas/explorer";

const PAGE_SIZE = 30;

/**
 * "Load more" rather than numbered pages: cursor pagination
 * (`paginatedSchema` in `src/lib/api/schemas/common.ts`) has no concept of a
 * page count, only "is there something older than this". Pages already
 * fetched are kept in local state and re-rendered as-is when a newer poll
 * tick refreshes the first page, so loading more never discards what a
 * reader has already scrolled past.
 */
export function ExplorerFeed() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderPages, setOlderPages] = useState<readonly ExplorerEventDto[]>([]);

  const query = useExplorerEvents({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });

  if (query.isPending) {
    if (olderPages.length === 0) {
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      );
    }
    // A later page is loading — keep showing what's already loaded rather
    // than replacing it with skeletons the reader has already scrolled past.
    return <ExplorerRows items={olderPages} nextCursor={undefined} loadingMore />;
  }

  if (query.isError) return <ErrorState error={query.error} />;

  const items = [...olderPages, ...query.data.items];

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="No events yet"
        description="Nothing has happened on the bridge yet."
      />
    );
  }

  return (
    <ExplorerRows
      items={items}
      nextCursor={query.data.next_cursor}
      onLoadMore={() => {
        setOlderPages(items);
        setCursor(query.data.next_cursor);
      }}
    />
  );
}

function ExplorerRows({
  items,
  nextCursor,
  onLoadMore,
  loadingMore = false,
}: {
  items: readonly ExplorerEventDto[];
  nextCursor: string | null | undefined;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="border-ink-100 divide-ink-100 divide-y overflow-hidden rounded-lg border">
        {items.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
      {(nextCursor || loadingMore) && (
        <Button
          variant="secondary"
          size="sm"
          className="self-center"
          loading={loadingMore}
          onClick={onLoadMore}
        >
          Load older events
        </Button>
      )}
    </div>
  );
}

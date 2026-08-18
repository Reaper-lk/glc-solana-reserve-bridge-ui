import { Skeleton } from "@/components/ui";
import { ErrorState } from "@/components/ui";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * The gross/fee/net breakdown, shown before confirmation.
 *
 * Every figure here is `quote.data` verbatim — nothing is computed by this
 * component. `gross_display_amount` / `fee_display_amount` /
 * `net_display_amount` are the backend's own fixed-point strings
 * (`POST /quote`, service/src/amount_conversion.rs); this component only
 * lays them out.
 */
export function QuoteBreakdown({ quote }: { quote: UseQueryResult<QuoteOutputDto> }) {
  if (quote.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (quote.isError) return <ErrorState error={quote.error} />;

  const data = quote.data;
  const feePercent = (data.fee_bps / 100).toFixed(data.fee_bps % 100 === 0 ? 0 : 2);

  return (
    <dl className="border-ink-100 flex flex-col gap-2 rounded-lg border p-4">
      <Row label="You bridge">
        <span className="tabular">
          {data.gross_display_amount}{" "}
          <span className="text-ink-500">{data.source_asset}</span>
        </span>
      </Row>
      <Row label={`Bridge fee (${feePercent}%)`}>
        <span className="tabular text-ink-600">
          −{data.fee_display_amount} {data.source_asset}
        </span>
      </Row>
      <div className="border-ink-200 border-t pt-2">
        <Row label="You receive" emphasize>
          <span className="tabular">
            {data.net_display_amount}{" "}
            <span className="text-ink-500">{data.destination_asset}</span>
          </span>
        </Row>
      </div>
    </dl>
  );
}

function Row({
  label,
  children,
  emphasize,
}: {
  label: string;
  children: React.ReactNode;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-body-sm text-ink-600">{label}</dt>
      <dd
        className={emphasize ? "text-heading-3 text-ink-950" : "text-body text-ink-900"}
      >
        {children}
      </dd>
    </div>
  );
}

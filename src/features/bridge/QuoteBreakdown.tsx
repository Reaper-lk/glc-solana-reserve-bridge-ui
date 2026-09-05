import { Skeleton } from "@/components/ui";
import { ErrorState } from "@/components/ui";
import { formatDisplayDecimal } from "@/lib/format/amount";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import type { UseQueryResult } from "@tanstack/react-query";

/**
 * The gross/fee/net breakdown, shown before confirmation.
 *
 * Every figure here is `quote.data` — nothing is computed by this component.
 * `gross_display_amount` / `fee_display_amount` / `net_display_amount` are
 * the backend's own fixed-point strings (`POST /quote`,
 * service/src/amount_conversion.rs); this component lays them out at the
 * shared two-decimal display precision and does nothing else to them.
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
          {display(data.gross_display_amount)}{" "}
          <span className="text-ink-500">{data.source_asset}</span>
        </span>
      </Row>
      <Row label={`Bridge fee (${feePercent}%)`}>
        <span className="tabular text-ink-600">
          −{display(data.fee_display_amount)} {data.source_asset}
        </span>
      </Row>
      <div className="border-ink-200 border-t pt-2">
        <Row label="You receive" emphasize>
          <span className="tabular">
            {display(data.net_display_amount)}{" "}
            <span className="text-ink-500">{data.destination_asset}</span>
          </span>
        </Row>
      </div>
    </dl>
  );
}

/**
 * Presentation only, over the backend's own figure. A string this helper
 * cannot read is shown exactly as the backend sent it — an unfamiliar format
 * is still the real number, and hiding it would be worse than not grouping it.
 */
function display(value: string): string {
  try {
    return formatDisplayDecimal(value);
  } catch {
    return value;
  }
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

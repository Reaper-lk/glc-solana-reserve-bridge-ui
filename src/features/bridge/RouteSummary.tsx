"use client";

import type { RouteAvailability } from "@/lib/bridge";
import type { ChainDescriptor } from "@/lib/bridge";
import type { QuoteOutputDto } from "@/lib/api/schemas/quote";
import { formatDisplayDecimal } from "@/lib/format/amount";

/**
 * The metadata under the form: what this transfer is, whether it can
 * happen, what it costs, and what arrives.
 *
 * # Everything here is about the SELECTED pair
 *
 * There is deliberately no aggregate — no "2 of 6 routes available", no
 * "both directions are available". A user is doing one transfer, and a
 * summary that describes the bridge as a whole makes them work out which
 * part applies to them. Every row below is derived from the pair currently
 * selected, and nothing else.
 *
 * # Nothing here is computed locally
 *
 * The fee rate and the received amount come from `POST /quote`, the same
 * endpoint that runs the server's own `compute_fee`. The availability
 * sentence is the backend's `disabled_reason`, passed through untouched.
 * This component formats; it does not decide.
 */
export function RouteSummary({
  source,
  destination,
  availability,
  quote,
  quotePending,
  requiredConfirmations,
}: {
  source: ChainDescriptor;
  destination: ChainDescriptor;
  availability: RouteAvailability;
  quote: QuoteOutputDto | undefined;
  quotePending: boolean;
  /**
   * Source-chain confirmations a deposit must reach before settlement
   * begins, when the route has a confirmation ramp at all. Absent for
   * contract-funded sources, whose obligation is observed once and folds
   * straight through — there is no count to progress past.
   */
  requiredConfirmations?: number | undefined;
}) {
  const status = statusLabel(availability);

  return (
    // A recessed block on the card's plane rather than a bordered card of
    // its own — the same `ink-50` step the FROM/TO panels sit on. The
    // outline it used to carry was the fourth nested rectangle in a 510px
    // card and the only one separating content that is already separated
    // by being the last thing in the form.
    <div className="bg-ink-50 rounded-lg px-3 py-2.5">
      {/* Two across at every width, never four. The compact card is ~510px
          wide, which leaves a four-column cell too narrow to hold
          "Goldcoin → Robinhood" or a fee's rate-and-amount on one line —
          each then ran onto a second line, costing more height than the
          second row of a two-column grid does. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <Row label="Route">
          {/* Wraps rather than truncates: a route name clipped to
              "Goldcoin → Robinho…" is worse than one on two lines. */}
          <span className="block">
            {source.name} → {destination.name}
          </span>
        </Row>

        <Row label="Status">
          <span>{status}</span>
        </Row>

        <Row label="Bridge fee">
          {/* The rate AND the amount. A percentage alone leaves the user to
              do arithmetic this app deliberately refuses to do for itself,
              and both figures are the backend's own — `POST /quote` runs
              the same `compute_fee` that a real settlement runs. */}
          <span className="tabular">
            {quote
              ? `${formatBps(quote.fee_bps)} · ${display(quote.fee_display_amount)} ${quote.source_asset}`
              : quotePending
                ? "…"
                : "—"}
          </span>
        </Row>

        <Row label="You receive">
          <span className="tabular">
            {quote
              ? `${display(quote.net_display_amount)} ${quote.destination_asset}`
              : quotePending
                ? "…"
                : "—"}
          </span>
        </Row>

        {requiredConfirmations !== undefined && (
          <Row label="Confirmations" className="col-span-2">
            <span>
              {requiredConfirmations} on {source.name} before settlement begins
            </span>
          </Row>
        )}

        {availability.kind !== "open" && (
          <div className="col-span-2">
            <dt className="sr-only">Why this route is unavailable</dt>
            {/* The backend's own sentence. This UI never authors a second
                explanation of a closed route, and never infers which gate
                refused. */}
            <dd className="text-body-sm text-ink-500 whitespace-pre-line">
              {availability.reason}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Row({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-body-sm text-ink-500 leading-4">{label}</dt>
      {/* Leading tightened, size untouched: a summary of four short
          figures does not need `body`'s reading leading, and two points a
          row is four off the card for nothing a reader can perceive. */}
      <dd className="text-body text-ink-900 min-w-0 leading-5">{children}</dd>
    </div>
  );
}

/**
 * The one-word state of the selected pair.
 *
 * `closed` reads as "Coming soon" because that is what the backend's own
 * copy for these routes says — support is in development — rather than a
 * promise this UI invented. `unimplemented` is a stronger statement: no
 * settlement machinery exists on either side, so no operator action opens
 * it. The backend's full sentence renders underneath either way.
 */
function statusLabel(availability: RouteAvailability): string {
  switch (availability.kind) {
    case "open":
      return "Available";
    case "closed":
      return "Coming soon";
    case "unimplemented":
      return "Not available";
    case "unknown":
      return "Checking…";
  }
}

/**
 * Presentation only, over the backend's own figure. A string this helper
 * cannot read is shown exactly as the backend sent it — an unfamiliar
 * format is still the real number, and hiding it would be worse than not
 * grouping it.
 */
function display(value: string): string {
  try {
    return formatDisplayDecimal(value);
  } catch {
    return value;
  }
}

/** "300" -> "3%", "50" -> "0.5%". Integer arithmetic; never a float rate. */
function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  return fraction === 0 ? `${whole}%` : `${(bps / 100).toFixed(2)}%`;
}

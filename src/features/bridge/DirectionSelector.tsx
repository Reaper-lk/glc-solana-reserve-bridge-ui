import { ArrowLeftRight } from "lucide-react";
import { routeOrder, routes } from "@/lib/bridge";
import { ROUTE_DISABLED_BADGE, routeEnabled } from "@/lib/bridge/direction-state";
import type { RouteViewDto } from "@/lib/api/schemas/chains";
import type { Route } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

/**
 * Route control: one radio button per route the bridge knows about, each
 * naming the token by where it already lives ("GLC L1", "GLC on Solana")
 * rather than by chain alone, so the reserve-backed model reads directly off
 * the control — there is no wrapped/native pair to explain.
 *
 * # Availability comes from the server, never from this component
 *
 * `routeViews` is `GET /chains`' route list. A route whose entry says
 * `enabled: false` — or which has no entry at all — renders visibly but is
 * not selectable. There is no local list of "routes we support" and no
 * environment variable gating any of this, which is what makes enabling a
 * route later a backend-only change.
 *
 * A disabled route is rendered as a real, non-interactive element rather
 * than hidden: users have been told Robinhood Network is coming, and a
 * silently absent option reads as a broken page.
 */
export function DirectionSelector({
  value,
  onChange,
  routeViews,
}: {
  value: Route;
  onChange: (route: Route) => void;
  routeViews: readonly RouteViewDto[] | undefined;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Bridge route"
      // Stacked below `sm`: two-across at 360px leaves each button so
      // little width that both token names truncate to fragments.
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      {routeOrder.map((id) => {
        const descriptor = routes[id];
        const view = routeViews?.find((v) => v.id === id);
        // Selectability, which is NOT the same question as submittability.
        //
        // Once the server has answered, its verdict is the only input.
        // Before it answers, fall back to local STRUCTURAL knowledge: a
        // route with no settlement direction has no machinery in this
        // build and stays disabled regardless. That fallback can only ever
        // keep a route closed, never open one the server closed — and it
        // avoids the selector going completely inert on first paint, which
        // it would if an unanswered request read as "closed" for
        // everything.
        //
        // Submission is separately fail-closed in `BridgeCard`'s gate
        // (which requires an affirmative `enabled`) and in the backend
        // itself, which returns 409 for a disabled route.
        const enabled =
          routeViews !== undefined ? routeEnabled(view) : descriptor.direction !== null;
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={descriptor.label}
            // Genuinely inert, not merely styled as such: `disabled` stops
            // click, keyboard activation and form participation together.
            disabled={!enabled}
            aria-disabled={!enabled}
            onClick={() => {
              if (enabled) onChange(id);
            }}
            className={cn(
              "min-w-0 flex-1 rounded-lg border px-4 py-3 text-left transition-colors",
              !enabled
                ? "border-ink-200 bg-ink-50 text-ink-400 cursor-not-allowed"
                : selected
                  ? "border-ink-950 bg-ink-950 text-white"
                  : "border-ink-200 hover:bg-ink-50 text-ink-900",
            )}
          >
            <span className="text-body-sm flex min-w-0 items-center gap-1.5 font-medium">
              <span className="min-w-0 truncate">{descriptor.from.token.name}</span>
              <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{descriptor.to.token.name}</span>
            </span>
            <span
              className={cn(
                "text-body-sm mt-0.5 flex min-w-0 items-center gap-1.5",
                !enabled ? "text-ink-400" : selected ? "text-ink-300" : "text-ink-500",
              )}
            >
              <span className="min-w-0 truncate">
                {descriptor.from.chain.name} → {descriptor.to.chain.name}
              </span>
              {!enabled ? (
                <span className="border-ink-300 text-ink-500 shrink-0 rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium tracking-wide uppercase">
                  {ROUTE_DISABLED_BADGE}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

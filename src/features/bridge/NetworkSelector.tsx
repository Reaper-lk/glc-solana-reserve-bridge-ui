"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ChainDescriptor } from "@/lib/bridge";

/**
 * The network picker used by both the FROM and TO panels.
 *
 * One control, one shape, however many networks exist. It renders whatever
 * options it is handed — it holds no list of networks, no per-network
 * branch, and no assumption about how many there are. Adding a network is
 * a registry entry, not a change here.
 *
 * # Availability is shown, not hidden
 *
 * An unavailable network stays in the list, visibly unselectable, with the
 * reason next to it. Removing it would leave a user wondering whether the
 * bridge supports their network at all; showing it answers that and says
 * when it cannot be used, which is the more useful of the two answers.
 *
 * # Accessibility
 *
 * A real listbox: the trigger owns `aria-haspopup="listbox"` and
 * `aria-expanded`, options carry `role="option"` with `aria-selected` and
 * `aria-disabled`, and the whole thing is keyboard-reachable. Disabled
 * options are exposed to assistive tech rather than removed, so their
 * reason is readable too.
 */

export interface NetworkOption {
  readonly chain: ChainDescriptor;
  /** Whether this option can be chosen right now. */
  readonly selectable: boolean;
  /**
   * Short status shown beside the network — "Available", "Coming soon",
   * "Same network". Sourced from the backend wherever it describes a
   * route's state; never invented to fill the slot.
   */
  readonly status: string;
  /** Longer explanation, when there is one worth showing. */
  readonly detail?: string | undefined;
}

export function NetworkSelector({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  /** "Source network" / "Destination network" — the accessible name. */
  label: string;
  value: ChainDescriptor;
  options: readonly NetworkOption[];
  onChange: (chainId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on an outside press or Escape. A picker that stays open behind
  // the next thing the user touches is worse than one extra tap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative h-full">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          // The right half of the amount row, not a box of its own: no
          // border and no radius except on the outer corners it shares
          // with the row, so its hover fill stops where the row's border
          // starts. `py-1.5` with the tightened leading below keeps it a
          // 48px control, comfortably above the 44px touch target.
          "hover:bg-ink-50 flex h-full w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors",
          // Bottom half when the row is stacked below `sm`, right half
          // above it.
          "rounded-b-lg sm:rounded-tr-lg sm:rounded-bl-none",
          // `ink-50` and not `ink-100` for that hover fill: the family
          // line below is `ink-500`, which clears 4.5:1 on `ink-50` — the
          // pair the panels themselves already use — but lands at 4.27:1
          // on `ink-100`. A hover state is not worth failing AA for.
          //
          // Focus is a RING and not a deeper fill, so it reads as focus
          // here rather than as a stronger hover, and stays distinct from
          // focus in the amount field, which turns the row's own border.
          "focus-visible:ring-ink-400 outline-none focus-visible:ring-2 focus-visible:ring-inset",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <NetworkMark chain={value} />
        <span className="min-w-0 flex-1">
          {/* Leading is tightened, never the size: the network name and its
              family both stay at their design sizes, so the row loses
              height without losing legibility. */}
          <span className="text-body text-ink-700 block truncate leading-5 font-medium">
            {value.name}
          </span>
          <span className="text-body-sm text-ink-500 block truncate leading-4">
            {value.family}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "text-ink-400 size-4 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* A `div`, not a `ul`: `role="listbox"` may contain only elements with
          `role="option"`, so wrapping each option in an `li` makes the list
          items disallowed children (axe `aria-required-children`). */}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          // Anchored to the trigger's RIGHT edge and given its own width
          // from `sm` up. The trigger is a 12rem column inside the amount
          // row there, and an option carrying a network's name, family,
          // status and the backend's reason for a closed route does not
          // read at 12rem. It opens leftward into the panel, which is
          // where the room is, so it can never leave the card.
          className="border-ink-200 bg-surface-raised shadow-elev-2 absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border py-1 sm:right-0 sm:w-80"
        >
          {options.map((option) => {
            const selected = option.chain.id === value.id;
            return (
              <button
                key={option.chain.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={!option.selectable}
                disabled={!option.selectable}
                onClick={() => {
                  if (!option.selectable) return;
                  onChange(option.chain.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                  option.selectable
                    ? "hover:bg-ink-50 focus-visible:bg-ink-50"
                    : "cursor-not-allowed opacity-60",
                )}
              >
                <NetworkMark chain={option.chain} />
                <span className="min-w-0 flex-1">
                  <span className="text-body text-ink-900 block truncate font-medium">
                    {option.chain.name}
                  </span>
                  <span className="text-body-sm text-ink-500 block truncate">
                    {option.chain.family}
                  </span>
                  <span className="text-body-sm text-ink-500 mt-0.5 block">
                    {option.status}
                  </span>
                  {option.detail && (
                    <span className="text-body-sm text-ink-500 mt-0.5 block whitespace-pre-line">
                      {option.detail}
                    </span>
                  )}
                </span>
                {selected && (
                  <Check aria-hidden="true" className="text-ink-500 size-4 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The network's identity mark. Colour is identity, never status — the same
 * separation `ChainBadge` keeps, and the reason a closed route is said in
 * words rather than by dimming a network's colour.
 */
function NetworkMark({ chain }: { chain: ChainDescriptor }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full border",
        "border-ink-200 bg-surface",
        chain.markClassName,
      )}
    >
      <span className="text-body-sm font-semibold">{chain.name.slice(0, 1)}</span>
    </span>
  );
}

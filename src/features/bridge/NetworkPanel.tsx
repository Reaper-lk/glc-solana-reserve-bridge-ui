"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * One half of the bridge form: a network, an amount, and whatever context
 * that network needs.
 *
 * The FROM and TO panels are the SAME component. Everything that differs
 * between them — an editable amount versus a quoted one, a wallet connect
 * versus a recipient field — arrives as a slot, so the layout is defined
 * once and cannot drift between the two halves as networks are added.
 *
 * # The amount and the network share one row
 *
 * From `sm` up, the amount field and the network picker sit side by side —
 * the amount is what the user is doing and the network is which pair it is
 * on, and stacking them made the panel two full-width bands tall for one
 * decision. The picker takes a fixed 12rem in that row rather than its
 * intrinsic width, so the FROM and TO amount fields start at the same x
 * however long "Native Network" or "Solana" happens to be.
 *
 * Below `sm` they stack, because a 390px panel cannot hold a readable
 * amount and a readable network name on one line — at that width the
 * amount would be the part that lost, and it is the part being typed.
 * Stacked, the amount stays FIRST: DOM order is reading order is tab
 * order at every width, so nothing is reordered visually behind a screen
 * reader's back.
 */
export function NetworkPanel({
  label,
  selector,
  amount,
  meta,
  context,
  className,
}: {
  /** "From" / "To". */
  label: string;
  /** The network picker. */
  selector: ReactNode;
  /** The amount field — editable on the source side, quoted on the destination side. */
  amount: ReactNode;
  /**
   * The lines under the amount row: limits, balance, capacity, and any
   * validation or quote message. Separate from `amount` because only the
   * FIELD shares a row with the picker — its metadata is full width.
   */
  meta?: ReactNode;
  /** Wallet, balance, or recipient controls for this network. May be absent. */
  context?: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        // Compact by intent: `gap-2`/`p-3` is the density a transfer form
        // wants, not the generous `gap-3`/`p-4` of a content card. Mobile
        // keeps the same rhythm — nothing inside is a tap target that
        // depends on the panel's own padding for its size.
        //
        // A RECESSED FILL, not a heavier outline. `ink-50` sits one step
        // under the card's `surface-raised` in both themes — lighter than
        // white in light, darker than the card in dark — so the panel is
        // separated by its plane and the hairline can drop to `ink-100`.
        // Three nested outlines were what made this read as boxes inside
        // boxes; only one of them was carrying meaning.
        "border-ink-100 bg-ink-50 flex flex-col gap-2 rounded-xl border p-3",
        className,
      )}
    >
      {/* `overline`, not `label`: FROM/TO orient the reader, they do not
          head a section. The smallest caption token this system has. */}
      <p className="text-overline text-ink-500 uppercase">{label}</p>

      {/* ONE control, two halves. The border, the fill and the focus state
          belong to this container; the field and the picker inside it are
          borderless and share a hairline divider, so the row reads as a
          single swap control rather than two boxes that happen to be
          adjacent. Raised back to `surface-raised` against the recessed
          panel — the plane, again, doing the work an outline was doing.

          `items-stretch` so the shorter half grows to the taller without
          either hard-coding the other's height. */}
      <div className="border-ink-200 bg-surface-raised focus-within:border-ink-400 flex flex-col rounded-lg border transition-colors sm:flex-row sm:items-stretch">
        <div className="min-w-0 sm:flex-1">{amount}</div>
        <div className="border-ink-200 w-full border-t sm:w-48 sm:shrink-0 sm:border-t-0 sm:border-l">
          {selector}
        </div>
      </div>

      {meta}
      {context}
    </section>
  );
}

/**
 * The editable amount row, for the source panel.
 *
 * The value stays a STRING from keystroke to submission — it is parsed to
 * exact base units by `validateAmount` and never passes through a
 * JavaScript number, because an 18-decimal Robinhood amount exceeds what a
 * double represents exactly by orders of magnitude.
 */
export function AmountInput({
  id,
  value,
  onChange,
  symbol,
  disabled = false,
  ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    // No border, no radius, no focus ring of its own: this is the left half
    // of the row above, and the row carries all three.
    <div className="flex h-full items-center pr-3">
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0.00"
        // An explicit colour rather than an inherited one: the panel sits on a
        // tinted surface in dark mode, where an inherited value renders the
        // typed amount dimmer than the quoted one beside it.
        // `ink-950`, the top of the scale: the amount is the strongest
        // element in the panel, and everything around it steps down from
        // here — the network name to `ink-700`, its family and every
        // helper line to `ink-500`.
        className="text-heading-2 tabular text-ink-950 placeholder:text-ink-500 min-w-0 flex-1 bg-transparent px-3 py-2 outline-none disabled:cursor-not-allowed"
      />
      <span className="text-body text-ink-500 font-medium">{symbol}</span>
    </div>
  );
}

/**
 * The read-only received amount, for the destination panel.
 *
 * Never computed here. The figure is `QuoteOutput.net_display_amount`, the
 * backend's own server-authoritative string — this UI does not do bridge
 * arithmetic, and a locally-derived "you receive" would be a second
 * calculation free to disagree with the one that actually settles.
 */
export function AmountEstimate({
  value,
  symbol,
  ariaLabel,
  pending = false,
}: {
  /** The backend's display string, or null when there is no quote to show. */
  value: string | null;
  symbol: string;
  ariaLabel: string;
  pending?: boolean;
}) {
  return (
    <div
      aria-label={ariaLabel}
      role="status"
      // Deliberately identical to the editable half. The tint that used to
      // mark it read-only fought the unified row — half the control shaded
      // and half not — and the distinction survives without it: there is no
      // caret, no focus ring, and `role="status"` announces it as output.
      className="flex h-full items-center pr-3"
    >
      <span
        className={cn(
          "text-heading-2 tabular min-w-0 flex-1 truncate px-3 py-2",
          // `ink-400` on the panel's tinted background falls below the 3:1
          // contrast threshold even at this size — a placeholder still has
          // to be readable.
          value === null ? "text-ink-500" : "text-ink-950",
        )}
      >
        {pending ? "…" : (value ?? "0.00")}
      </span>
      <span className="text-body text-ink-500 font-medium">{symbol}</span>
    </div>
  );
}

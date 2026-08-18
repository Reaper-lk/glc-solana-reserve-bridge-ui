"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * StickyActionBar (design spec F3, A11, acceptance criterion 6).
 *
 * Below `md` the primary action sticks to the bottom of the viewport so it
 * stays thumb-reachable however far the form has scrolled. At `md` and above
 * it returns to normal flow inside the card.
 *
 * One DOM node, not two. Rendering a desktop button and a separate mobile one
 * would put two controls with the same accessible name on the page, and a
 * screen-reader user would have to work out which is real. `position: sticky`
 * achieves the same layout with a single button.
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Negative margins let the bar span the card's padding on mobile so it
        // reads as a bar rather than a floating button.
        "border-ink-200 sticky bottom-0 z-10 -mx-4 border-t bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "md:static md:mx-0 md:border-0 md:bg-transparent md:p-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

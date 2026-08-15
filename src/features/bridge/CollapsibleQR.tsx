"use client";

import { ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { encode } from "uqr";
import { cn } from "@/lib/utils/cn";

/**
 * CollapsibleQR (design spec F4, G4, A11).
 *
 * This component carries the mobile inversion, and it is a layout inversion
 * rather than a reflow: on desktop the QR leads, because the user is scanning
 * it with a phone held in their other hand. Below `md` it collapses behind a
 * disclosure, because their Goldcoin wallet is on the same phone and nobody can
 * scan their own screen. The Copy Address button leads there instead.
 *
 * The inversion is expressed as CSS state, not a JavaScript media query:
 * `hidden md:block` when closed means desktop always shows it and mobile does
 * not, with no measurement, no effect, and nothing to mismatch at hydration.
 */

/**
 * Quiet zone, in modules.
 *
 * The QR specification requires four. uqr defaults to one, which scans
 * unreliably against a light background — and a deposit address that will not
 * scan sends the user to retype it by hand.
 */
const QUIET_ZONE = 4;

/**
 * Error correction level H recovers 30% of the symbol.
 *
 * The centre mark below occupies roughly 2% of the area, so the budget is
 * spent many times over. Anything less than H and the decoration would be
 * trading scan reliability for decoration on a screen about moving funds.
 */
const ERROR_CORRECTION = "H" as const;

export function CollapsibleQR({ value, label }: { value: string; label: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "border-ink-300 text-body text-ink-900 hover:bg-ink-50 flex h-10 items-center justify-center gap-2 rounded-md border",
          // The control exists only where the QR is collapsed. `display: none`
          // removes it from the accessibility tree too, so a desktop user is
          // never offered a toggle for something already on screen.
          "md:hidden",
        )}
      >
        Show QR code
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 transition-transform duration-[var(--duration-fast)]",
            open && "rotate-180",
          )}
        />
      </button>

      <p className="text-body-sm text-ink-500 md:hidden">
        For scanning from another device.
      </p>

      <div id={panelId} className={open ? "block" : "hidden md:block"}>
        <QrCode value={value} label={label} />
      </div>
    </div>
  );
}

function QrCode({ value, label }: { value: string; label: string }) {
  const { path, size } = useMemo(() => buildPath(value), [value]);
  const centre = size / 2;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="border-ink-200 size-[180px] rounded-md border bg-white p-1"
      shapeRendering="crispEdges"
    >
      {/*
        One path for every dark module rather than several hundred <rect>
        elements. Same rendering, a fraction of the DOM.
      */}
      <path d={path} className="fill-ink-950" />
      {/* Brand mark, per G4. Identity only — it carries no status. */}
      <path
        d={`M${centre},${centre - 1.8}L${centre + 1.8},${centre}L${centre},${centre + 1.8}L${centre - 1.8},${centre}Z`}
        className="fill-chain-goldcoin stroke-white"
        strokeWidth={0.6}
      />
    </svg>
  );
}

function buildPath(value: string): { path: string; size: number } {
  const result = encode(value, { ecc: ERROR_CORRECTION, border: QUIET_ZONE });

  let path = "";
  for (let y = 0; y < result.size; y += 1) {
    const row = result.data[y];
    if (!row) continue;
    for (let x = 0; x < result.size; x += 1) {
      if (row[x]) path += `M${x},${y}h1v1h-1z`;
    }
  }

  return { path, size: result.size };
}

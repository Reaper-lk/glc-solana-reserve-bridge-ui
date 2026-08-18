import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/**
 * The official Goldcoin logo (public/branding/goldcoin-logo.png, 512×512).
 *
 * Served unoptimized so the artwork's exact bytes reach the browser — no
 * re-encoding, no recoloring — and downscaled by the browser from the
 * 512px source, which keeps it crisp at any display density. `alt` is
 * empty because every placement pairs the mark with the visible
 * "Goldcoin Bridge" wordmark; announcing both would read the name twice.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      src="/branding/goldcoin-logo.png"
      alt=""
      width={512}
      height={512}
      unoptimized
      priority
      className={cn("size-7 shrink-0 select-none", className)}
    />
  );
}

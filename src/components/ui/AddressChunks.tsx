import { chunkAddress, truncateMiddle } from "@/lib/format/address";
import { cn } from "@/lib/utils/cn";

/**
 * Address display (design spec E3 / A8 / G7).
 *
 * Full mode chunks the address in groups of four and emphasises the first and
 * last group, because comparing the ends is how people actually catch a
 * clipboard swap. It is the only form permitted in a confirmation context.
 *
 * Compact mode middle-truncates for dense rows. The full value is always
 * available to assistive technology and on hover, so nothing is silently lost.
 */
export function AddressChunks({
  address,
  size = "md",
  className,
}: {
  address: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const chunks = chunkAddress(address);
  const lastIndex = chunks.length - 1;

  const sizeClass =
    size === "lg" ? "text-heading-3" : size === "sm" ? "text-mono-sm" : "text-mono";

  return (
    <span
      className={cn(
        "inline-flex flex-wrap gap-x-2 gap-y-1 font-mono",
        sizeClass,
        className,
      )}
    >
      {/* The unbroken value for screen readers and for copy-by-selection. */}
      <span className="sr-only">{address}</span>
      {chunks.map((chunk, index) => (
        <span
          key={`${index}-${chunk}`}
          aria-hidden="true"
          className={
            index === 0 || index === lastIndex
              ? "text-ink-950 font-semibold"
              : "text-ink-700"
          }
        >
          {chunk}
        </span>
      ))}
    </span>
  );
}

/** Middle-truncated form for tables and rows. Never used before signing. */
export function AddressCompact({
  address,
  lead = 6,
  tail = 4,
  className,
}: {
  address: string;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("text-mono-sm text-ink-700 font-mono", className)}
      title={address}
    >
      <span className="sr-only">{address}</span>
      <span aria-hidden="true">{truncateMiddle(address, lead, tail)}</span>
    </span>
  );
}

import { cn } from "@/lib/utils/cn";

/**
 * Progress indicators (design spec E11).
 *
 * Determinate wherever a denominator exists. Gold is the fill colour here per
 * E1 — gold marks brand, the active timeline step and focus. It never conveys
 * warning or failure, so acceptance criterion 10 holds.
 *
 * Widths transition over 300ms so a confirmation increment reads as progress
 * rather than a jump. Under reduced motion the global rule collapses that to an
 * instant change with no information lost.
 */

export function LinearProgress({
  current,
  total,
  label,
  className,
}: {
  current: number;
  total: number;
  /** Describes what is progressing, e.g. "Confirmations". */
  label: string;
  className?: string;
}) {
  const safeTotal = Math.max(1, total);
  const clamped = Math.min(Math.max(0, current), safeTotal);
  const percent = (clamped / safeTotal) * 100;

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-valuetext={`${clamped} of ${safeTotal}`}
      aria-label={label}
      className={cn("bg-ink-100 h-1.5 w-full overflow-hidden rounded-full", className)}
    >
      <div
        className="bg-gold-400 h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-standard)]"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * Threshold signing, shown as discrete segments — one per required signature.
 *
 * A continuous bar would misrepresent what is happening: four of five
 * signatures is not "80% done", it is four independent operators having signed.
 */
export function SignatureMeter({
  collected,
  required,
  className,
}: {
  collected: number;
  required: number;
  className?: string;
}) {
  const total = Math.max(1, required);
  const filled = Math.min(Math.max(0, collected), total);

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label={`${filled} of ${total} signatures collected`}
    >
      <span aria-hidden="true" className="inline-flex gap-1">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-4 w-2.5 rounded-sm transition-colors duration-[var(--duration-base)]",
              index < filled ? "bg-success-500" : "bg-ink-200",
            )}
          />
        ))}
      </span>
      <span className="text-body-sm text-ink-600 tabular">
        {filled} of {total}
      </span>
    </span>
  );
}

/**
 * Compact circular x/N for tight spaces such as the mobile sticky header.
 * Drawn with an SVG stroke offset rather than an animated library.
 */
export function ConfirmationRing({
  current,
  total,
  label,
  className,
}: {
  current: number;
  total: number;
  label: string;
  className?: string;
}) {
  const safeTotal = Math.max(1, total);
  const clamped = Math.min(Math.max(0, current), safeTotal);
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / safeTotal);

  return (
    <span
      className={cn("relative inline-flex size-9 shrink-0", className)}
      role="img"
      aria-label={`${label}: ${clamped} of ${safeTotal}`}
    >
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          className="stroke-ink-200"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-gold-400 transition-[stroke-dashoffset] duration-[var(--duration-slow)] ease-[var(--ease-standard)]"
        />
      </svg>
      <span
        aria-hidden="true"
        className="text-mono-sm text-ink-950 tabular absolute inset-0 flex items-center justify-center"
      >
        {clamped}
      </span>
    </span>
  );
}

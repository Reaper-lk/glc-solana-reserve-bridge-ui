import { cn } from "@/lib/utils/cn";

/**
 * Skeleton (design spec E10).
 *
 * Used only for a first load, never for a refresh: live financial values stay
 * on screen with a freshness stamp while they update, because blanking them
 * during a poll looks like the system lost state.
 *
 * The shimmer is suppressed under reduced motion by using a motion-safe
 * variant, leaving a static block that conveys the same thing.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-ink-100 block rounded-sm",
        "motion-safe:bg-[linear-gradient(90deg,var(--color-ink-100)_25%,var(--color-ink-50)_50%,var(--color-ink-100)_75%)]",
        "motion-safe:animate-shimmer motion-safe:bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

/** Wraps a loading region so assistive technology is told what is happening. */
export function SkeletonRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

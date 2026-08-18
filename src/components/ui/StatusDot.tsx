import { toneStyles, type StatusDescriptor } from "@/lib/status";
import { cn } from "@/lib/utils/cn";

/**
 * StatusDot (design spec E9).
 *
 * The dot is decorative; the label carries the meaning. `label` is required and
 * is rendered either visibly or to assistive technology, so a status can never
 * reach the screen as colour alone (acceptance criterion 1).
 */
export function StatusDot({
  status,
  showLabel = false,
  live = false,
  className,
}: {
  status: StatusDescriptor;
  /** Render the label visibly alongside the dot. */
  showLabel?: boolean;
  /** Adds the halo used for a live, in-progress state. */
  live?: boolean;
  className?: string;
}) {
  const tone = toneStyles[status.tone];

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative inline-flex size-2 shrink-0">
        {live && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -inset-1 rounded-full opacity-60",
              tone.halo,
              "motion-safe:animate-pulse-halo",
            )}
          />
        )}
        <span
          aria-hidden="true"
          className={cn("relative size-2 rounded-full", tone.dot)}
        />
      </span>
      <span className={cn(showLabel ? cn("text-body-sm", tone.text) : "sr-only")}>
        {status.label}
      </span>
    </span>
  );
}

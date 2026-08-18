import { toneStyles, type StatusDescriptor } from "@/lib/status";
import { cn } from "@/lib/utils/cn";

/**
 * StatusBadge (design spec E9): a pill carrying colour AND icon AND text.
 *
 * There is no prop for colour and no way to omit the label, so every badge in
 * the product satisfies acceptance criterion 1 by construction.
 */
export function StatusBadge({
  status,
  size = "md",
  className,
}: {
  status: StatusDescriptor;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone = toneStyles[status.tone];
  const Icon = status.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        tone.badge,
        size === "sm" ? "text-body-sm px-2 py-0.5" : "text-body-sm px-2.5 py-1",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
      {status.label}
    </span>
  );
}

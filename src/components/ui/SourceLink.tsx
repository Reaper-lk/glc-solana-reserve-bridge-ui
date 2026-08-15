import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * SourceLink (design spec 7.6, acceptance criterion 5).
 *
 * Every headline number and chain reference points at something the user can
 * check for themselves. When no URL is configured the content renders as plain
 * text rather than as a link to nowhere — a missing explorer is honest, a dead
 * link is not.
 */
export function SourceLink({
  href,
  children,
  label,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  /** Describes the destination for assistive technology. */
  label: string;
  className?: string;
}) {
  if (!href) {
    return <span className={cn("text-ink-700", className)}>{children}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      className={cn(
        "text-info-700 inline-flex items-center gap-1 underline underline-offset-2",
        "hover:text-info-500",
        className,
      )}
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
    </a>
  );
}

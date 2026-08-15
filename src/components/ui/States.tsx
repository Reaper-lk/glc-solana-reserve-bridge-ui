import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Alert } from "./Alert";
import { cn } from "@/lib/utils/cn";
import { toPresentation } from "@/lib/api/errors";

/**
 * Empty and error states (design spec E12 / E13).
 *
 * Empty states state the situation and the next action. No humour, no
 * illustration-heavy filler.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-12 text-center", className)}>
      <Icon aria-hidden="true" className="text-ink-300 size-8" strokeWidth={2} />
      <p className="text-heading-3 text-ink-950 mt-3">{title}</p>
      {description && (
        <p className="text-body-sm text-ink-600 mt-1 max-w-prose">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Renders any thrown value through the required three-part formula. Components
 * pass the error straight through; they never compose their own error copy.
 */
export function ErrorState({
  error,
  actions,
  className,
}: {
  error: unknown;
  actions?: ReactNode;
  className?: string;
}) {
  const presentation = toPresentation(error);

  return (
    <Alert
      level="danger"
      title={presentation.what}
      funds={presentation.funds}
      next={presentation.next}
      {...(actions ? { actions } : {})}
      className={className}
    />
  );
}

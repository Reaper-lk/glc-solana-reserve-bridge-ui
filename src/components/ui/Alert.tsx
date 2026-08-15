import { CircleAlert, CircleCheck, CircleX, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toneStyles, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils/cn";

/**
 * Alert (design spec E7).
 *
 * Rules encoded here:
 *   - every alert carries icon + colour + text, never colour alone
 *   - errors are never toasts; a financial error persists until resolved
 *   - a warning or danger alert states what happened, what it means for the
 *     user's funds, and what to do next, in that order
 *
 * The `funds` and `next` props are required on warning and danger levels, so
 * acceptance criterion 3 cannot be skipped at a call site.
 */

const levelIcons: Record<StatusTone, LucideIcon> = {
  success: CircleCheck,
  warn: CircleAlert,
  danger: CircleX,
  info: Info,
  neutral: Info,
};

/**
 * Optional props are written as `?: T | undefined` because
 * `exactOptionalPropertyTypes` is enabled: a wrapper forwarding a possibly
 * undefined value would otherwise not typecheck.
 */
interface AlertBaseProps {
  title: string;
  children?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
  /** `page` centres the alert as a full-page state. */
  format?: "inline" | "banner" | "page" | undefined;
}

type AlertProps = AlertBaseProps &
  (
    | { level: "info" | "success" | "neutral"; funds?: string; next?: string }
    | {
        level: "warn" | "danger";
        /** What this means for the user's funds. Required. */
        funds: string;
        /** What the user should do next. Required. */
        next: string;
      }
  );

export function Alert({
  level,
  title,
  funds,
  next,
  children,
  actions,
  format = "inline",
  className,
}: AlertProps) {
  const tone = toneStyles[level];
  const Icon = levelIcons[level];
  const isError = level === "warn" || level === "danger";

  return (
    <div
      // Errors are announced; informational alerts are not, so a page of
      // alerts does not become unusable with a screen reader.
      role={isError ? "alert" : undefined}
      className={cn(
        "rounded-md border-l-4 p-4",
        tone.alert,
        format === "page" && "mx-auto max-w-prose text-center",
        className,
      )}
    >
      <div className={cn("flex gap-3", format === "page" && "flex-col items-center")}>
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-5 shrink-0", tone.text)}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn("text-heading-3", tone.text)}>{title}</p>

          {children && <div className="text-body-sm text-ink-700">{children}</div>}

          {/* The three-part error formula, in the required order. */}
          {funds && <p className="text-body-sm text-ink-700">{funds}</p>}
          {next && <p className="text-body-sm text-ink-700">{next}</p>}

          {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Card (design spec E6). Near-flat: a hairline border and a very soft shadow.
 * Cards never nest more than two deep.
 */

const cardVariants = cva("rounded-lg", {
  variants: {
    variant: {
      default: "border border-ink-200 bg-surface-raised shadow-elev-1",
      raised: "border border-ink-200 bg-surface-raised shadow-elev-2",
      inset: "border border-ink-200 bg-ink-50",
      /** Highlighted trust information. Brand, never status. */
      accent: "border border-gold-200 bg-gold-50",
      interactive:
        "border border-ink-200 bg-surface-raised shadow-elev-1 transition-shadow hover:shadow-elev-2 cursor-pointer",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-4 md:p-6",
      lg: "p-6 md:p-8",
    },
  },
  defaultVariants: { variant: "default", padding: "md" },
});

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  children: ReactNode;
}

export function Card({ variant, padding, className, children, ...props }: CardProps) {
  return (
    <div className={cn(cardVariants({ variant, padding }), className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <h2 className="text-heading-2 text-ink-950">{title}</h2>
      {action}
    </div>
  );
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-ink-200 text-body-sm text-ink-600 mt-4 border-t pt-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

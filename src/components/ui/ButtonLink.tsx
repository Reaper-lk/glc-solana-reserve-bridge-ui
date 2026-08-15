import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { buttonVariants } from "./Button";
import { cn } from "@/lib/utils/cn";

/**
 * A link styled as a button.
 *
 * Navigation is an anchor and an action is a button — nesting one in the other
 * produces invalid markup and breaks keyboard and screen-reader behaviour, so
 * the two are kept as separate components sharing one set of variants.
 */
export function ButtonLink({
  href,
  variant,
  size,
  fullWidth,
  className,
  external = false,
  children,
}: VariantProps<typeof buttonVariants> & {
  href: string;
  className?: string;
  external?: boolean;
  children: ReactNode;
}) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

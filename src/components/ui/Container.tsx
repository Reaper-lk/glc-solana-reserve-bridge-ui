import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Page container (design spec E4). Widths come from the layout tokens so no
 * page invents its own measure.
 */
export function Container({
  size = "page",
  as: Element = "div",
  className,
  children,
}: {
  size?: "page" | "wide" | "prose" | "card";
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const width = {
    page: "max-w-page",
    wide: "max-w-wide",
    prose: "max-w-prose",
    card: "max-w-card",
  }[size];

  return (
    <Element className={cn("mx-auto w-full px-4 md:px-6", width, className)}>
      {children}
    </Element>
  );
}

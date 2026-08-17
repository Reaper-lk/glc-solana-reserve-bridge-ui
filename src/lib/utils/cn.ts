import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock class names. This project's
 * type scale (`--text-display-xl` … `--text-mono-sm` in app/globals.css)
 * produces `text-*` utilities it cannot classify, and its fallback treats
 * an unknown `text-x` as a text COLOR — so `cn("text-white", …,
 * "text-body-lg")` silently dropped `text-white` as a "duplicate color",
 * rendering, e.g., the primary Button's label ink-on-ink. Declaring the
 * full custom scale as font-size classes lets sizes and colors coexist
 * and keeps genuine conflicts (two sizes, two colors) resolving last-wins.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-xl",
            "display-lg",
            "heading-1",
            "heading-2",
            "heading-3",
            "body-lg",
            "body",
            "body-sm",
            "label",
            "overline",
            "mono-lg",
            "mono",
            "mono-sm",
          ],
        },
      ],
    },
  },
});

/** Merge conditional class names, resolving Tailwind conflicts last-wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

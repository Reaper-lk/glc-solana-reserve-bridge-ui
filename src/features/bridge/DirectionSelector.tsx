import { ArrowLeftRight } from "lucide-react";
import { directions } from "@/lib/bridge";
import type { Direction } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

/**
 * Direction control: one radio button per supported direction, each naming
 * the token by where it already lives ("GLC L1", "GLC on Solana") rather
 * than by chain alone, so the reserve-backed model reads directly off the
 * control — there is no wrapped/native pair to explain.
 */
export function DirectionSelector({
  value,
  onChange,
}: {
  value: Direction;
  onChange: (direction: Direction) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Bridge direction"
      className="flex items-center gap-2"
    >
      {(Object.keys(directions) as Direction[]).map((id) => {
        const descriptor = directions[id];
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={descriptor.label}
            onClick={() => onChange(id)}
            className={cn(
              "min-w-0 flex-1 rounded-lg border px-4 py-3 text-left transition-colors",
              selected
                ? "border-ink-950 bg-ink-950 text-white"
                : "border-ink-200 hover:bg-ink-50 text-ink-900",
            )}
          >
            <span className="text-body-sm flex min-w-0 items-center gap-1.5 font-medium">
              <span className="min-w-0 truncate">{descriptor.from.token.name}</span>
              <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{descriptor.to.token.name}</span>
            </span>
            <span
              className={cn(
                "text-body-sm mt-0.5 block truncate",
                selected ? "text-ink-300" : "text-ink-500",
              )}
            >
              {descriptor.from.chain.name} → {descriptor.to.chain.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

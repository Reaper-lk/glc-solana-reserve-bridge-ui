import { ArrowLeftRight } from "lucide-react";
import { directions } from "@/lib/bridge";
import type { Direction } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

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
            onClick={() => onChange(id)}
            className={cn(
              "flex-1 rounded-lg border px-4 py-3 text-left transition-colors",
              selected
                ? "border-ink-950 bg-ink-950 text-white"
                : "border-ink-200 hover:bg-ink-50 text-ink-900",
            )}
          >
            <span className="text-body-sm flex items-center gap-2 font-medium">
              {descriptor.from.chain.name}
              <ArrowLeftRight aria-hidden="true" className="size-3.5 shrink-0" />
              {descriptor.to.chain.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}

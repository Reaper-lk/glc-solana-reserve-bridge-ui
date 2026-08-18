import { CircleCheck, CircleDot, Circle } from "lucide-react";
import { toneStyles } from "@/lib/status";
import { happyPathFor, REQUEST_STATE_LABELS } from "@/lib/bridge";
import type { RequestState } from "@/lib/api/schemas/transfer";
import type { Direction } from "@/lib/api/schemas/common";
import { cn } from "@/lib/utils/cn";

/**
 * Renders the happy-path sequence for this transfer's direction, with
 * whatever the backend actually reports as the current state highlighted.
 *
 * There is no server-provided per-step timeline or duration estimate on
 * this backend (`TransferView` carries only a single current `state`), so
 * unlike a richer timeline this never claims an ETA — it shows real elapsed
 * time only, and states plainly when a step's timing is unknown.
 */
export function TransferStepper({
  direction,
  state,
  sourceConfirmations,
  requiredSourceConfirmations,
}: {
  direction: Direction;
  state: RequestState;
  sourceConfirmations: number;
  requiredSourceConfirmations: number | null;
}) {
  const sequence = happyPathFor(direction);
  const currentIndex = sequence.indexOf(state);

  return (
    <ol className="flex flex-col gap-0">
      {sequence.map((step, index) => {
        const status: "done" | "active" | "pending" =
          currentIndex === -1
            ? "pending"
            : index < currentIndex
              ? "done"
              : index === currentIndex
                ? "active"
                : "pending";
        const tone =
          toneStyles[
            status === "done" ? "success" : status === "active" ? "info" : "neutral"
          ];
        const Icon =
          status === "done" ? CircleCheck : status === "active" ? CircleDot : Circle;

        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-5 shrink-0",
                  tone.text,
                  status === "pending" && "opacity-60",
                )}
                strokeWidth={2}
              />
              {index < sequence.length - 1 && (
                <div className={cn("my-1 w-px flex-1", tone.dot, "opacity-30")} />
              )}
            </div>
            <div className="pb-6">
              {/*
                A pending step is de-emphasised by tone (neutral grey vs
                success/info) alone, never by opacity: opacity blends text
                toward the background and silently drops it below AA
                contrast (axe color-contrast, caught against real transfer
                data — every fixture-mode scan happened to land on a step
                sequence short enough to never render a pending step).
              */}
              <p className={cn("text-body-sm font-medium", tone.text)}>
                {REQUEST_STATE_LABELS[step]}
              </p>
              {step === "Confirming" &&
                status === "active" &&
                requiredSourceConfirmations !== null && (
                  <p className="text-body-sm text-ink-500 tabular">
                    {sourceConfirmations} of {requiredSourceConfirmations} confirmations
                  </p>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

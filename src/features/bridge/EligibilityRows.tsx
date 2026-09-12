"use client";

import { CircleAlert, CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { StatusDot } from "@/components/ui";
import type { StatusDescriptor } from "@/lib/status";
import {
  ELIGIBILITY_BLOCKED_LABEL,
  ELIGIBILITY_CHECKING_LABEL,
  ELIGIBILITY_ELIGIBLE_LABEL,
  ELIGIBILITY_SIDE_LABEL,
  ELIGIBILITY_UNAVAILABLE_LABEL,
  formatEligibilityCooldown,
  type EligibilitySide,
  type EligibilityVerdict,
  type WalletEligibility,
} from "@/lib/bridge/eligibility";

/**
 * The rolling-24h eligibility readout, beside the address and amount
 * fields.
 *
 * # Compact on purpose
 *
 * Two rows in the same recessed block the route summary uses, not a card.
 * This is a precondition a user checks in passing, alongside the balance
 * and the minimum — not an event. The blocked case is the only one that
 * grows, by one line naming when the window reopens, because that is the
 * only case where there is something to plan around.
 *
 * # Colour never carries the meaning
 *
 * Each row is a `StatusDot`, which renders its label as text and takes a
 * status token rather than a colour — so the verdict reaches a screen
 * reader and a monochrome display intact. Green is eligible, amber is
 * checking or inside a cooldown that will clear itself, red is a check
 * that could not be established. Amber rather than red for a cooldown is
 * the honest distinction: one reopens on its own, the other needs
 * something fixed.
 */

const ELIGIBLE: StatusDescriptor = {
  label: ELIGIBILITY_ELIGIBLE_LABEL,
  tone: "success",
  icon: CircleCheck,
};

const CHECKING: StatusDescriptor = {
  label: ELIGIBILITY_CHECKING_LABEL,
  tone: "warn",
  icon: CircleDashed,
};

const BLOCKED: StatusDescriptor = {
  label: ELIGIBILITY_BLOCKED_LABEL,
  tone: "warn",
  icon: CircleAlert,
};

const UNAVAILABLE: StatusDescriptor = {
  label: ELIGIBILITY_UNAVAILABLE_LABEL,
  tone: "danger",
  icon: CircleX,
};

function descriptorFor(
  verdict: EligibilityVerdict,
  side: EligibilitySide,
): StatusDescriptor {
  switch (verdict.kind) {
    case "eligible":
      return ELIGIBLE;
    case "checking":
      return CHECKING;
    case "blocked":
      // Only the blocked side is marked. The other side genuinely did
      // clear, and colouring both red would tell a user to wait out a
      // window their destination address is not in.
      return verdict.sides.includes(side) ? BLOCKED : ELIGIBLE;
    case "unavailable":
      return UNAVAILABLE;
  }
}

function sideOf(
  verdict: EligibilityVerdict,
  side: EligibilitySide,
): WalletEligibility | null {
  if (verdict.kind !== "blocked") return null;
  return side === "source" ? verdict.answer.sourceSide : verdict.answer.destinationSide;
}

export function EligibilityRows({
  verdict,
  nowSeconds,
}: {
  verdict: EligibilityVerdict;
  /**
   * The current unix second, supplied by the caller so it is one value
   * held still across a render rather than a clock read per row.
   */
  nowSeconds: number;
}) {
  const sides: readonly EligibilitySide[] = ["source", "destination"];

  return (
    <div className="bg-ink-50 rounded-lg px-3 py-2.5">
      <dl className="grid gap-y-1.5">
        {sides.map((side) => {
          const answerSide = sideOf(verdict, side);
          const cooldown =
            answerSide !== null && !answerSide.eligible
              ? formatEligibilityCooldown(answerSide, nowSeconds)
              : null;
          return (
            <div key={side} className="grid grid-cols-2 items-baseline gap-x-4">
              <dt className="text-ink-500 text-body-sm">
                {ELIGIBILITY_SIDE_LABEL[side]}
              </dt>
              <dd className="text-body-sm">
                <StatusDot status={descriptorFor(verdict, side)} showLabel />
                {/* The reopen time, on its own line under the label it
                    belongs to. Rendered only when the backend published a
                    usable one — an unstated window is never guessed at. */}
                {cooldown !== null && (
                  <span className="text-ink-500 mt-0.5 block">
                    Eligible again in {cooldown}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

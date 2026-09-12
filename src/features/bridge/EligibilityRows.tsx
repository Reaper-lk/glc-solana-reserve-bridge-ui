"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
} from "lucide-react";
import { StatusDot } from "@/components/ui";
import type { StatusDescriptor } from "@/lib/status";
import {
  ELIGIBILITY_BLOCKED_LABEL,
  ELIGIBILITY_CHECKING_LABEL,
  ELIGIBILITY_ELIGIBLE_LABEL,
  ELIGIBILITY_NOT_APPLICABLE_LABEL,
  ELIGIBILITY_SIDE_LABEL,
  ELIGIBILITY_UNAVAILABLE_LABEL,
  formatEligibilityCooldown,
  type EligibilitySide,
  type EligibilityVerdict,
  type RouteEligibility,
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

/**
 * A side with no wallet for the browser to ask about — the source of a
 * route funded by sending to an address the backend issues.
 *
 * Neutral, and worded as WHEN the check happens rather than as a pass.
 * "Eligible" here would claim a verdict about a wallet nobody has named
 * yet; "Unavailable" would report a fault where there is none and send a
 * user looking for a problem to fix. The rule still applies — the backend
 * enforces it against the wallet the deposit really arrives from — and
 * this row says exactly that.
 */
const NOT_APPLICABLE: StatusDescriptor = {
  label: ELIGIBILITY_NOT_APPLICABLE_LABEL,
  tone: "neutral",
  icon: CircleSlash,
};

/**
 * The answer behind a verdict, for the two kinds that carry one.
 *
 * `checking` and `unavailable` hold no answer, so no side of theirs can
 * be reported as out of scope — which is the strict reading: a check that
 * did not complete stays "Unavailable" on both rows.
 */
function answerOf(verdict: EligibilityVerdict): RouteEligibility | null {
  if (verdict.kind === "eligible" || verdict.kind === "blocked") return verdict.answer;
  return null;
}

function descriptorFor(
  verdict: EligibilityVerdict,
  side: EligibilitySide,
): StatusDescriptor {
  const answer = answerOf(verdict);
  if (answer !== null && !sideOfAnswer(answer, side).applicable) {
    return NOT_APPLICABLE;
  }
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

function sideOfAnswer(answer: RouteEligibility, side: EligibilitySide) {
  return side === "source" ? answer.sourceSide : answer.destinationSide;
}

function sideOf(
  verdict: EligibilityVerdict,
  side: EligibilitySide,
): WalletEligibility | null {
  if (verdict.kind !== "blocked") return null;
  return sideOfAnswer(verdict.answer, side);
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

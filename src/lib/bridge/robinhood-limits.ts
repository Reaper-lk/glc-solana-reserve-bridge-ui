import type { RobinhoodLimitsDto } from "@/lib/api/schemas/robinhood";
import { isRobinhoodAvailable } from "@/lib/api/schemas/robinhood";
import { ROBINHOOD_DECIMALS } from "./robinhood-amount";
import { atomicRescaleFloor } from "./canonical";

/**
 * Which side of the Robinhood custody contract a transfer touches.
 *
 * The contract bounds LEGS, not routes. `deposit` enters it and is capped
 * by `inboundMax`; `payout` leaves it and is capped by `outboundMax`. A
 * route is a backend concept and the contract has never heard of one.
 */
export type RobinhoodContractLeg = "deposit" | "payout";

const MAX_FIELD: Record<
  RobinhoodContractLeg,
  "inbound_max_atomic" | "outbound_max_atomic"
> = {
  deposit: "inbound_max_atomic",
  payout: "outbound_max_atomic",
};

/**
 * The contract leg a Goldcoin<->Robinhood pair uses, or `null` for a pair
 * that touches the contract on neither side.
 *
 * `RhnToGlc` deposits into the contract, so it is bounded by
 * `inboundMax`; `GlcToRhn` is paid out of it, so it is bounded by
 * `outboundMax`. The Solana<->Robinhood pairs return `null`: they have no
 * settlement machinery on either side, and publishing a ceiling for a
 * route that can never run would state a permission that does not exist.
 *
 * # Why this reads chain ids rather than a resolved route
 *
 * `BridgeForm` resolves the route exactly once and everything else reads
 * that result — this is the one exception, and it is a compiler
 * constraint rather than a design preference. A value the form has handed
 * to an imported function can no longer be a `useMemo` dependency there
 * (the React Compiler cannot prove it is not mutated afterwards, and
 * declines to optimize the whole component), and the resolved route has
 * been handed to several by the time limits are computed. Deriving the
 * leg from the two chain ids sidesteps that.
 *
 * The cost is a second statement of which pairs are which, so
 * `robinhood-per-transfer-max.test.ts` pins this function against
 * `resolveRoute` for every pair the form can reach. They cannot drift
 * apart without that test failing.
 */
export function robinhoodContractLeg(
  sourceChainId: string,
  destinationChainId: string,
): RobinhoodContractLeg | null {
  if (sourceChainId === "robinhood" && destinationChainId === "goldcoin") {
    return "deposit";
  }
  if (sourceChainId === "goldcoin" && destinationChainId === "robinhood") {
    return "payout";
  }
  return null;
}

/**
 * The authoritative per-transaction maximum for one Robinhood leg, in the
 * SOURCE token's own base units — ready to be handed to `validateAmount`
 * and `display` beside an amount the user typed.
 *
 * # Where the number comes from
 *
 * `GET /robinhood/limits`, which the backend fills from a live `limits()`
 * read of the deployed `GlcRobinhoodBridge` and from nowhere else. There
 * is no constant here and no fallback to `GET /limits`: that endpoint
 * describes the Solana program, whose ceilings Robinhood does not
 * enforce, and substituting it would publish a maximum no chain applies.
 *
 * The two fields are required to hold the same number — the backend
 * configures a single `[robinhood.policy].per_transfer_limit` and
 * `glc-admin robinhood-preflight` reports any divergence between it and
 * either field as a mismatch. They are still read separately rather than
 * collapsed, because the contract is the enforcement layer: a deployment
 * whose fields have drifted must show each leg the ceiling that actually
 * bounds it, not one picked from whichever side was read first.
 *
 * # `undefined` means "not read", never "no maximum"
 *
 * Every field is null unless `availability` is exactly `"available"`, and
 * an unknown availability spelling fails closed through
 * {@link isRobinhoodAvailable}. Returning `undefined` leaves
 * `AmountBounds.maximum` absent, which is the state the form was in
 * before this existed: no client-side ceiling shown and none enforced,
 * with the contract still refusing anything above its own. A zero would
 * instead read as "this route takes nothing", and a remembered figure
 * would state a limit nobody confirmed.
 *
 * # Units
 *
 * The endpoint reports Robinhood's native 18 decimals. A `deposit` leg
 * sources from Robinhood and needs no conversion; a `payout` leg sources
 * from Goldcoin's canonical 8, so the figure narrows by exactly the 10^10
 * factor between them. FLOORED, never rounded — the same "never more
 * permissive than the chain" convention `atomicRescaleFloor` exists for.
 */
export function robinhoodPerTransferMaximum(
  leg: RobinhoodContractLeg | null,
  limits: RobinhoodLimitsDto | undefined,
  sourceDecimals: number,
): string | undefined {
  if (leg === null) return undefined;
  if (!limits || !isRobinhoodAvailable(limits.availability)) return undefined;
  const raw = limits[MAX_FIELD[leg]];
  if (raw === null) return undefined;
  return atomicRescaleFloor(raw, ROBINHOOD_DECIMALS, sourceDecimals);
}

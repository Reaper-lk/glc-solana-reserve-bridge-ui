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

/**
 * There is deliberately no `robinhoodPerTransferMinimum` here.
 *
 * One used to exist, deriving an entry floor from the contract's
 * `inboundMin`/`outboundMin` and grossing the payout leg up through the
 * fee, because `outboundMin` bounds the NET payout. The arithmetic was
 * right; the rule was not. A chain's floor is not a statement about what
 * a user may type, and deriving one from it produced entry minimums that
 * moved with the fee — "102.061856 GLC", "102.56410256 GLC".
 *
 * The minimum is now one published policy figure, identical on every
 * route: `GET /chains`' `min_transfer_atomic`, read by
 * `routeSourceMinimum` in `./route-resolution` and rendered without
 * adjustment. If you find yourself about to add a fee-aware minimum
 * helper back to this file, that is the bug.
 */

const MAX_FIELD: Record<
  RobinhoodContractLeg,
  "inbound_max_atomic" | "outbound_max_atomic"
> = {
  deposit: "inbound_max_atomic",
  payout: "outbound_max_atomic",
};

/**
 * The rolling accumulator each leg is charged against, keyed by the ROUTE
 * the backend names it after.
 *
 * `deposit` is `RhnToGlc`, charged by `deposit()` against
 * `inboundRollingLimit`; `payout` is `GlcToRhn`, charged by
 * `executePayout` against `outboundRollingLimit`. The backend publishes
 * these route-named precisely so this table is the only place the two
 * vocabularies meet.
 */
const WINDOW_FIELD: Record<
  RobinhoodContractLeg,
  "rhn_to_glc_rolling_window" | "glc_to_rhn_rolling_window"
> = {
  deposit: "rhn_to_glc_rolling_window",
  payout: "glc_to_rhn_rolling_window",
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

/**
 * What is left of this leg's rolling 24-hour window right now, in the
 * SOURCE token's own base units — the figure behind "… GLC remaining
 * today".
 *
 * # Authoritative, not derived
 *
 * This is `remaining_atomic` from the accumulator the CONTRACT charges:
 * `inboundWindow()` for `RhnToGlc`, `outboundWindow()` for `GlcToRhn`,
 * each against its own `…RollingLimit`, projected for now by the same
 * backend helper `GET /robinhood/reserve` uses. Nothing is subtracted
 * here, and nothing is inferred from this UI's own view of recent
 * activity: a figure assembled client-side would be a second opinion about
 * a number only the chain holds, and it would be wrong the moment any
 * other participant transacted.
 *
 * The backend has already applied the contract's own rollover rule, so an
 * expired bucket arrives as the FULL limit rather than a stale total —
 * which is what `_consumeWindow` would really leave on its next write.
 *
 * # What the number is denominated in
 *
 * `deposit` (`RhnToGlc`): the window is charged the deposited amount, so
 * this is directly comparable with what the user types.
 *
 * `payout` (`GlcToRhn`): the window is charged the NET payout, so this
 * slightly understates the gross a user could still spend. Left
 * understated deliberately — grossing it up would advertise headroom the
 * contract would refuse, and the safe direction for a remaining figure is
 * down. FLOORED on narrowing for the same reason.
 */
export function robinhoodRollingRemaining(
  leg: RobinhoodContractLeg | null,
  limits: RobinhoodLimitsDto | undefined,
  sourceDecimals: number,
): string | undefined {
  if (leg === null) return undefined;
  if (!limits || !isRobinhoodAvailable(limits.availability)) return undefined;
  // `nullish`: a backend too old to publish these omits the key entirely,
  // which must read as "not known" and blank the figure — never as zero,
  // which would claim an exhausted window.
  const window = limits[WINDOW_FIELD[leg]];
  if (window === null || window === undefined) return undefined;
  return atomicRescaleFloor(window.remaining_atomic, ROBINHOOD_DECIMALS, sourceDecimals);
}

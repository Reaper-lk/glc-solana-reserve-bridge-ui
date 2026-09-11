/**
 * Which chain's published per-transfer ceiling bounds a route.
 *
 * # Why a table rather than two booleans at the call site
 *
 * The bridge form used to decide this inline: `GET /limits` governs the
 * pair iff neither side is Robinhood, otherwise the custody contract does.
 * That held while Robinhood only ever paired with Goldcoin. It stops
 * holding on the cross routes, where BOTH chains publish a ceiling — a
 * `SolToRhn` transfer is bounded by the Solana program on the way in and
 * by the custody contract on the way out — and an inline `!==
 * "robinhood"` silently picked the wrong one.
 *
 * So the rule is stated once, as data, keyed by the pair.
 *
 * # The rule: the SOURCE chain's ceiling, then the destination's
 *
 * A per-transfer maximum is shown so a user knows what they may SUBMIT, so
 * the figure that matters is the one the source chain enforces on the
 * deposit. Goldcoin publishes none — there is no per-transfer ceiling on
 * sending to a deposit address — so a Goldcoin-sourced route falls through
 * to the ceiling its destination's payout is bounded by, which is the only
 * one that exists for it.
 *
 * That gives, for all six:
 *
 * | route      | source ceiling         | shown                  |
 * |------------|------------------------|------------------------|
 * | `GlcToSol` | none (Goldcoin)        | Solana `per_transfer_limit` (payout) |
 * | `GlcToRhn` | none (Goldcoin)        | contract `outboundMax` (payout)     |
 * | `SolToGlc` | Solana program         | Solana `per_transfer_limit`         |
 * | `SolToRhn` | Solana program         | Solana `per_transfer_limit`         |
 * | `RhnToGlc` | contract `inboundMax`  | contract `inboundMax`               |
 * | `RhnToSol` | contract `inboundMax`  | contract `inboundMax`               |
 *
 * # Why the cross routes show ONE ceiling and not the tighter of two
 *
 * Both of their chains bound them, in different units — the Solana mint's
 * 6 decimals against Robinhood's 18 — and the backend publishes no
 * combined figure. Converting one into the other's unit to take a minimum
 * would put a number on screen that no endpoint ever stated and no chain
 * ever enforces as written, which is the class of derived figure this app
 * does not display. The source-side ceiling is authoritative for the
 * action the user is about to take; the destination's is enforced by the
 * destination, and a transfer it would refuse fails there rather than here.
 *
 * # Why it reads chain ids rather than a resolved route
 *
 * Same compiler constraint `robinhoodContractLeg` documents: `BridgeForm`
 * has already handed its resolved route to other functions by the time
 * limits are computed, after which the React Compiler will not accept it —
 * or anything derived from it — as a `useMemo` dependency.
 * `route-limits.test.ts` pins this against `resolveRoute` for every pair
 * the form can reach, so the two cannot drift.
 */

/**
 * Which published ceiling bounds a pair, or `null` for a pair with no
 * route (including a same-network one) or a network this build does not
 * describe.
 *
 * - `solana-program` — `GET /limits`' `per_transfer_limit`, in the reserve
 *   mint's 6-decimal units.
 * - `robinhood-contract` — `GET /robinhood/limits`' `inbound_max_atomic` /
 *   `outbound_max_atomic`, in Robinhood's native 18.
 */
export type PerTransferCeiling = "solana-program" | "robinhood-contract";

/** `sourceChainId -> destinationChainId -> the ceiling that bounds it`. */
const CEILING: Readonly<Record<string, Readonly<Record<string, PerTransferCeiling>>>> = {
  // Goldcoin publishes no source-side per-transfer ceiling, so each of
  // these takes the ceiling its DESTINATION payout is bounded by.
  goldcoin: { solana: "solana-program", robinhood: "robinhood-contract" },
  // The Solana program bounds what may be deposited into it, whichever
  // reserve eventually pays the route out.
  solana: { goldcoin: "solana-program", robinhood: "solana-program" },
  // The custody contract's `inboundMax` bounds every deposit into it.
  robinhood: { goldcoin: "robinhood-contract", solana: "robinhood-contract" },
};

export function perTransferCeiling(
  sourceChainId: string,
  destinationChainId: string,
): PerTransferCeiling | null {
  if (sourceChainId === destinationChainId) return null;
  return CEILING[sourceChainId]?.[destinationChainId] ?? null;
}

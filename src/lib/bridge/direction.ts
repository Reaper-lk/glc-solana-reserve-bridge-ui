import type { Route, SettlementRoute } from "@/lib/api/schemas/common";
import {
  descriptorFor,
  GOLDCOIN_GLC,
  ROBINHOOD_GLC,
  SOLANA_GLC,
  type ChainDescriptor,
  type TokenDescriptor,
} from "./chain-registry";

/**
 * The registry entry for a chain this module knows exists. Throws rather
 * than falling back, so a descriptor removed from the registry is a
 * startup failure instead of a silently mislabelled route.
 */
function requireChain(chainId: string): ChainDescriptor {
  const descriptor = descriptorFor(chainId);
  if (!descriptor) throw new Error(`no chain descriptor for ${chainId}`);
  return descriptor;
}

export { GOLDCOIN_GLC, ROBINHOOD_GLC, SOLANA_GLC };
export type { ChainDescriptor, TokenDescriptor };

/**
 * The direction model.
 *
 * Each direction names its source and destination chain and the token that
 * moves on each side — the same existing GLC on both, never a synthetic
 * derivative. The bridge form reads from this table rather than branching on
 * the direction at every call site.
 *
 * Minimums, maximums, the fee rate, and reserve capacity are NOT here —
 * those are policy, they change without a frontend deploy, and they come
 * from `GET /limits`, `GET /reserve`, `GET /status`. Decimals ARE here as a
 * display default (Goldcoin's 8 is protocol-fixed; the Solana Token-2022
 * mint's 6 is the published canonical value) — `POST /quote` reports the
 * live decimals actually used for a given amount and is authoritative
 * whenever it disagrees.
 */

export interface DirectionSide {
  readonly chain: ChainDescriptor;
  readonly token: TokenDescriptor;
}

export interface DirectionDescriptor {
  readonly id: SettlementRoute;
  readonly from: DirectionSide;
  readonly to: DirectionSide;
  readonly label: string;
  /** The reserve this direction draws its payout from (`Direction::destination_reserve()`). */
  readonly destinationReserve: "goldcoin" | "solana" | "robinhood";
  /**
   * How the SOURCE side of this route is funded by the user.
   *
   * - `goldcoin-deposit-address` — the backend creates the request and
   *   returns a per-request Goldcoin address to send to (`POST /transfers`).
   * - `solana-program` / `robinhood-contract` — there is no backend create
   *   endpoint; the user's own wallet calls the chain directly and the
   *   backend's indexer folds the resulting on-chain obligation. This is a
   *   deliberate backend design, not a gap (`service/src/api.rs`).
   */
  readonly funding: "goldcoin-deposit-address" | "solana-program" | "robinhood-contract";
}

const GOLDCOIN = requireChain("goldcoin");
const SOLANA = requireChain("solana");
const ROBINHOOD = requireChain("robinhood");

// The minimum GROSS amount a user may enter/bridge, in either direction,
// is no longer a fixed constant here — a hardcoded "100 GLC" quietly went
// stale when the real bridge fee moved from 1% to 6% (later 3%), since
// it was tuned to that specific rate (100 GLC gross nets to exactly
// 99 GLC at 1%; at 6% it nets to only 94, UNDER the on-chain floor). It
// is now computed at
// use time from `GET /limits`' own `min_transfer_amount`/`bridge_fee_bps`
// — see `minimumGrossCanonicalForMinTransferAmount` in `./canonical` and
// its call site in `BridgeCard.tsx` — so it can never drift out of sync
// with either value again.

/**
 * Descriptors for every route the backend names — all six.
 *
 * Being in this table says the UI knows how to NAME and describe the
 * route. It says nothing about availability: `./route-availability` is the
 * only thing that answers "can this be used", and several of these ship
 * disabled backend-side.
 *
 * It used to hold four, because `SolToRhn`/`RhnToSol` had no settlement
 * machinery on either side and there was no flow to describe. The backend
 * has since shipped both (`GET /chains` reports `implemented: true` for
 * all six), so the table is total over `Route` and there is no longer a
 * second, parallel "display only" table beside it — which is what made
 * `routeDisplay` below a single lookup.
 *
 * Whether THIS BUILD can construct the on-chain deposit a route needs is a
 * third, separate question, answered by `./route-execution` and by nothing
 * here.
 */
export const directions: Record<SettlementRoute, DirectionDescriptor> = {
  GlcToSol: {
    id: "GlcToSol",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${GOLDCOIN_GLC.name} → ${SOLANA_GLC.name}`,
    destinationReserve: "solana",
    funding: "goldcoin-deposit-address",
  },
  SolToGlc: {
    id: "SolToGlc",
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${SOLANA_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
    funding: "solana-program",
  },
  GlcToRhn: {
    id: "GlcToRhn",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    label: `${GOLDCOIN_GLC.name} → ${ROBINHOOD_GLC.name}`,
    destinationReserve: "robinhood",
    funding: "goldcoin-deposit-address",
  },
  RhnToGlc: {
    id: "RhnToGlc",
    from: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${ROBINHOOD_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
    funding: "robinhood-contract",
  },
  // The two cross routes. Neither touches Goldcoin at all: `SolToRhn`
  // sources from the Solana program and settles onto the Robinhood
  // reserve, `RhnToSol` sources from the Robinhood custody contract and
  // settles onto the Solana reserve. The reserve named here is the one
  // `Direction::destination_reserve()` names, which is what decides whose
  // capacity figure the status card may show.
  SolToRhn: {
    id: "SolToRhn",
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    label: `${SOLANA_GLC.name} → ${ROBINHOOD_GLC.name}`,
    destinationReserve: "robinhood",
    funding: "solana-program",
  },
  RhnToSol: {
    id: "RhnToSol",
    from: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${ROBINHOOD_GLC.name} → ${SOLANA_GLC.name}`,
    destinationReserve: "solana",
    funding: "robinhood-contract",
  },
};

const OPPOSITES: Record<SettlementRoute, SettlementRoute> = {
  GlcToSol: "SolToGlc",
  SolToGlc: "GlcToSol",
  GlcToRhn: "RhnToGlc",
  RhnToGlc: "GlcToRhn",
  SolToRhn: "RhnToSol",
  RhnToSol: "SolToRhn",
};

/** The reverse route. Being the reverse of an open route implies nothing about availability. */
export function oppositeDirection(direction: SettlementRoute): SettlementRoute {
  return OPPOSITES[direction];
}

/**
 * Presentation for EVERY route the backend can name.
 *
 * This used to be a second table beside {@link directions}, covering the
 * two routes that table excluded, plus a branch here to pick between them.
 * Both routes are now in `directions` — the backend implements all six — so
 * the branch is gone and there is exactly one place a route's label, source
 * and destination are stated.
 *
 * Having a label here is not an implication that a route works. It is the
 * opposite: it is what lets the UI say clearly that one does not.
 */
export interface RouteDisplay {
  readonly from: DirectionSide;
  readonly to: DirectionSide;
  readonly label: string;
}

export function routeDisplay(route: Route): RouteDisplay {
  const descriptor = directions[route];
  return { from: descriptor.from, to: descriptor.to, label: descriptor.label };
}

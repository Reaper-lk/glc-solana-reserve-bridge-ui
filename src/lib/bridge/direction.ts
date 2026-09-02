import type { Chain, Direction, Route } from "@/lib/api/schemas/common";

/**
 * The route model.
 *
 * Each route names its source and destination chain and the token that moves
 * on each side — the same existing GLC on both, never a synthetic
 * derivative. The bridge form reads from this table rather than branching on
 * the route at every call site.
 *
 * # What is deliberately NOT here
 *
 * **Whether a route is usable.** That is the backend's verdict, delivered by
 * `GET /chains` (`src/lib/api/schemas/chains.ts`) and enforced by the same
 * gate behind `POST /transfers` and `POST /quote`. This table describes what
 * a route IS; the server decides whether it is open. Keeping the two apart
 * is what makes enabling Robinhood later a backend configuration change with
 * no frontend deploy — and it is why there is no `enabled` field on
 * `RouteDescriptor` and no `NEXT_PUBLIC_*` variable controlling one.
 *
 * Minimums, maximums, the fee rate, and reserve capacity are likewise not
 * here — those are policy, they change without a frontend deploy, and they
 * come from `GET /limits`, `GET /reserve`, `GET /status`. Decimals ARE here
 * as a display default (Goldcoin's 8 is protocol-fixed; the Solana
 * Token-2022 mint's 6 is the published canonical value) — `POST /quote`
 * reports the live decimals actually used for a given amount and is
 * authoritative whenever it disagrees.
 *
 * Robinhood's token decimals are `null`, not a placeholder: they are one of
 * the chain parameters that remain unresolved, and inventing one here would
 * put a fabricated number directly into amount rendering.
 */

export interface ChainDescriptor {
  readonly id: Chain;
  readonly name: string;
}

export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  /**
   * `null` when the chain's token decimals are not yet known. Code
   * formatting an amount for such a side must decline to render a figure,
   * never substitute a default.
   */
  readonly decimals: number | null;
}

/**
 * A token whose decimals are known and verified. The two live tokens are
 * typed this way so every existing `GOLDCOIN_GLC.decimals` /
 * `SOLANA_GLC.decimals` call site keeps seeing a plain `number` — only a
 * token read off an arbitrary `RouteDescriptor` has to consider `null`.
 */
export interface KnownDecimalsToken extends TokenDescriptor {
  readonly decimals: number;
}

export interface RouteSide {
  readonly chain: ChainDescriptor;
  readonly token: TokenDescriptor;
}

export interface RouteDescriptor {
  readonly id: Route;
  readonly from: RouteSide;
  readonly to: RouteSide;
  readonly label: string;
  /**
   * The reserve this route draws its payout from, or `null` for a route
   * with no settlement machinery. `null` is not "unknown" — it means there
   * is no reserve because there is no settlement.
   */
  readonly destinationReserve: "goldcoin" | "solana" | null;
  /**
   * The settled `Direction` this route produces, or `null` if it produces
   * none. Mirrors the backend's deliberately partial `Route -> Direction`
   * conversion: only a route with a direction can ever appear on a
   * transfer.
   */
  readonly direction: Direction | null;
}

const GOLDCOIN: ChainDescriptor = { id: "goldcoin", name: "Goldcoin L1" };
const SOLANA: ChainDescriptor = { id: "solana", name: "Solana" };
const ROBINHOOD: ChainDescriptor = { id: "robinhood", name: "Robinhood Network" };

/**
 * Token display names, used everywhere a route is described to a user.
 * "GLC L1" / "GLC on Solana" names the asset by where it already lives,
 * which is the point of a reserve-backed bridge — there is no "native" vs
 * "wrapped" pair to distinguish, just the same GLC on two networks.
 */
export const GOLDCOIN_GLC: KnownDecimalsToken = {
  symbol: "GLC",
  name: "GLC L1",
  decimals: 8,
};
export const SOLANA_GLC: KnownDecimalsToken = {
  symbol: "GLC",
  name: "GLC on Solana",
  decimals: 6,
};
/** Decimals deliberately unknown — see this module's docs. */
export const ROBINHOOD_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC on Robinhood",
  decimals: null,
};

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

export const routes: Record<Route, RouteDescriptor> = {
  GlcToSol: {
    id: "GlcToSol",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${GOLDCOIN_GLC.name} → ${SOLANA_GLC.name}`,
    destinationReserve: "solana",
    direction: "GlcToSol",
  },
  SolToGlc: {
    id: "SolToGlc",
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${SOLANA_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
    direction: "SolToGlc",
  },
  GlcToRhn: {
    id: "GlcToRhn",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    label: `${GOLDCOIN_GLC.name} → ${ROBINHOOD_GLC.name}`,
    destinationReserve: null,
    direction: null,
  },
  RhnToGlc: {
    id: "RhnToGlc",
    from: { chain: ROBINHOOD, token: ROBINHOOD_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${ROBINHOOD_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: null,
    direction: null,
  },
};

/** Every route, in the order the selector renders them. */
export const routeOrder: readonly Route[] = [
  "GlcToSol",
  "SolToGlc",
  "GlcToRhn",
  "RhnToGlc",
];

/**
 * The reverse of a route, for the swap control.
 *
 * A table lookup rather than the ternary this used to be. With four routes,
 * a `route === "GlcToSol" ? "SolToGlc" : "GlcToSol"` maps every other route
 * to `GlcToSol`, which would have made the swap control quietly teleport a
 * user off a disabled Robinhood route onto a live one.
 */
const OPPOSITE: Record<Route, Route> = {
  GlcToSol: "SolToGlc",
  SolToGlc: "GlcToSol",
  GlcToRhn: "RhnToGlc",
  RhnToGlc: "GlcToRhn",
};

export function oppositeRoute(route: Route): Route {
  return OPPOSITE[route];
}

/**
 * Back-compatible aliases, retained so call sites that genuinely deal in
 * settled directions (transfer detail, explorer rows, activity rows) keep
 * reading naturally and this refactor does not ripple into files with
 * nothing to do with route selection. `Direction` is a subset of `Route`,
 * so indexing `directions[transfer.direction]` still type-checks.
 */
export const directions = routes;
export const oppositeDirection = oppositeRoute;
export type DirectionDescriptor = RouteDescriptor;
export type DirectionSide = RouteSide;

import type { Route } from "@/lib/api/schemas/common";
import { routeSchema } from "@/lib/api/schemas/common";
import type { ChainsViewDto } from "@/lib/api/schemas/chains";
import { GOLDCOIN_DECIMALS } from "@/lib/config/env";
import { atomicRescaleCeil } from "./canonical";

/**
 * The ONE place a (source, destination) network pair becomes a backend
 * route.
 *
 * # Why this is a single function and a single table
 *
 * The UI is network-first: a user picks two networks, never a route name.
 * That mapping is the seam where a presentation choice turns into a claim
 * about what the backend will do with someone's money, so it exists
 * exactly once. Every consumer — the form, the CTA, the summary, the
 * availability lookup — calls this and nothing else. There is no second
 * derivation to drift from it.
 *
 * # Failing closed is the whole design
 *
 * Three outcomes, and only one of them names a route:
 *
 * - a defined pair resolves to its route;
 * - a same-chain pair is refused (this bridge moves GLC BETWEEN networks;
 *   there is no self-route, and silently treating one as a no-op would be
 *   a transfer that takes a fee for nothing);
 * - anything else — including a pair involving a network this build has
 *   never heard of — is `undefined-pair`.
 *
 * `undefined-pair` NEVER falls back to a working route. That is the one
 * mistake in this file that could send funds to the wrong network: a pair
 * defaulting to, say, `GlcToSol` would take a Robinhood-bound deposit and
 * pay it out on Solana. So there is no default arm, no `??`, and no
 * "closest match" — an unrecognised pair yields no route, and every caller
 * treats the absence of a route as unusable.
 *
 * # Adding a network
 *
 * Add its rows to `ROUTE_TABLE`. Nothing else in the UI changes: the
 * selector already iterates the chain registry, the form already renders
 * one shape, and availability already comes from `GET /chains`. Resolving
 * a route here still says NOTHING about whether it may be used — every
 * Robinhood-legged route resolves today, and a deployment may have all of
 * them closed.
 */

/** `sourceChainId -> destinationChainId -> route`. */
type RouteTable = Readonly<Record<string, Readonly<Record<string, Route>>>>;

/**
 * The complete pair→route mapping, mirroring the backend's `Route` enum
 * (`service/src/routes.rs`) exactly — all six routes it defines appear
 * here. Being in this table is not a claim that a route is open, and not a
 * claim that this build can start one: the UI must be able to NAME an
 * unusable route in order to explain it.
 */
const ROUTE_TABLE: RouteTable = {
  goldcoin: { solana: "GlcToSol", robinhood: "GlcToRhn" },
  solana: { goldcoin: "SolToGlc", robinhood: "SolToRhn" },
  robinhood: { goldcoin: "RhnToGlc", solana: "RhnToSol" },
};

export type RouteResolution =
  /** This pair is a route the backend defines. Not a claim that it is open. */
  | { readonly kind: "route"; readonly route: Route }
  /** Source and destination are the same network. */
  | { readonly kind: "same-chain" }
  /** No route exists for this pair, or a network in it is unknown here. */
  | { readonly kind: "undefined-pair" };

export function resolveRoute(
  sourceChainId: string,
  destinationChainId: string,
): RouteResolution {
  if (sourceChainId === destinationChainId) return { kind: "same-chain" };
  const route = ROUTE_TABLE[sourceChainId]?.[destinationChainId];
  if (route === undefined) return { kind: "undefined-pair" };
  // Belt and braces: the table is typed to `Route`, and this re-parses it
  // against the wire enum so a typo here cannot produce a route name the
  // backend has never heard of.
  const parsed = routeSchema.safeParse(route);
  return parsed.success
    ? { kind: "route", route: parsed.data }
    : { kind: "undefined-pair" };
}

/** The route for a pair, or `null`. The narrow form, for callers that only need that. */
export function routeForPair(
  sourceChainId: string,
  destinationChainId: string,
): Route | null {
  const resolution = resolveRoute(sourceChainId, destinationChainId);
  return resolution.kind === "route" ? resolution.route : null;
}

/**
 * Whether a pair is STRUCTURALLY defined — i.e. the reverse of a route
 * exists at all.
 *
 * Used by the direction switch, which must not offer to flip into a pair
 * that no route describes. Structurally defined is not available: the
 * reverse of an open route is very often a closed one.
 */
export function isDefinedPair(
  sourceChainId: string,
  destinationChainId: string,
): boolean {
  return resolveRoute(sourceChainId, destinationChainId).kind === "route";
}

/**
 * The destination networks that form a defined route from `sourceChainId`.
 * Drives which options the destination selector can offer.
 */
export function destinationsFor(sourceChainId: string): readonly string[] {
  return Object.keys(ROUTE_TABLE[sourceChainId] ?? {});
}

/** Every source network with at least one defined outbound route. */
export function sourceChainIds(): readonly string[] {
  return Object.keys(ROUTE_TABLE);
}

/**
 * Every route with `chainId` on either side, in table order.
 *
 * For consumers scoped to ONE network — the integration strip, the gating
 * of a network-specific endpoint poll — which would otherwise each keep
 * their own list of "the Robinhood routes" and each go stale on its own the
 * next time a route is added. Read off the same table every other
 * derivation uses, so there is nothing to keep in sync.
 */
export function routesTouchingChain(chainId: string): readonly Route[] {
  const touching: Route[] = [];
  for (const [source, destinations] of Object.entries(ROUTE_TABLE)) {
    for (const [destination, route] of Object.entries(destinations)) {
      if (source === chainId || destination === chainId) touching.push(route);
    }
  }
  return touching;
}

/**
 * The authoritative source-side minimum for one route, in the SOURCE
 * token's own base units — the figure the bridge form renders as
 * "Min … GLC".
 *
 * # One rule, one place
 *
 * `GET /chains` publishes `min_transfer_atomic` per route: the backend's
 * single policy floor, the same value `POST /transfers` and `POST /quote`
 * admit against and the same one a fold parks below. Every route carries
 * it, so this function has no per-route arithmetic and no route-family
 * branch — which is the point. The per-route derivation it replaced is
 * what produced "102.061856 GLC".
 *
 * # Never adjusted for the fee
 *
 * The fee is deducted AFTER the minimum is checked, so a minimum transfer
 * delivers less than the minimum and that is correct. Grossing this
 * figure up would publish a floor the backend does not apply and would
 * refuse amounts it accepts.
 *
 * # Units, and why the rounding is UP
 *
 * The wire figure is canonical 8dp. A source chain with finer precision
 * (Robinhood's 18 decimals) widens exactly; one with coarser precision
 * (the Solana mint's 6) narrows, and narrowing is CEILED — a floor
 * rounded down would admit an amount the backend refuses, which is the
 * one direction a minimum must never move.
 *
 * # Why it takes two chain ids rather than a resolved route
 *
 * Partly a compiler constraint — `BridgeForm` has already handed its
 * resolved `route` to other functions by the time limits are computed,
 * after which the React Compiler will not accept it, or anything derived
 * from it, as a `useMemo` dependency (the same constraint documented on
 * `robinhoodContractLeg`). But unlike that case this costs nothing and
 * duplicates nothing: each `RouteView` already carries `source_chain` and
 * `destination_chain`, so matching on them is reading the backend's own
 * pairing rather than restating this app's.
 *
 * `undefined` when no route joins those two chains, when the backend
 * predates the field, or while `GET /chains` is still in flight. Never a
 * fallback: an invented floor is the bug this whole field exists to end.
 */
export function routeSourceMinimum(
  chains: ChainsViewDto | undefined,
  sourceChainId: string,
  destinationChainId: string,
  sourceDecimals: number,
): string | undefined {
  const raw = chains?.routes.find(
    (r) => r.source_chain === sourceChainId && r.destination_chain === destinationChainId,
  )?.min_transfer_atomic;
  if (raw === undefined) return undefined;
  return atomicRescaleCeil(raw, GOLDCOIN_DECIMALS, sourceDecimals);
}

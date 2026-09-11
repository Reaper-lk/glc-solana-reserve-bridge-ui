import type { Route, SettlementRoute } from "@/lib/api/schemas/common";

/**
 * Whether THIS BUILD can construct the on-chain deposit a route needs.
 *
 * # Why this is a separate question from availability
 *
 * `GET /chains` answers whether the BACKEND will admit a transfer on a
 * route. It cannot answer whether this frontend knows how to produce the
 * transaction that starts one, and those are genuinely different facts:
 * every route here is implemented backend-side, and two of them are
 * started by a wallet call whose payload this build cannot yet build
 * correctly.
 *
 * Conflating them was never an option in either direction. Reporting a
 * route unavailable because this build cannot drive it would put a UI
 * limitation in the backend's voice — and /status would show it as a
 * closed route, which is a different remedy. Reporting it executable
 * because the backend says `available: true` is far worse: the submit path
 * would send a deposit anyway.
 *
 * # The two routes this build refuses to start, and why
 *
 * Both failures end with a user's GLC committed on-chain and no automatic
 * way back, which is the one class of mistake these modules are written to
 * make impossible rather than unlikely.
 *
 * - `SolToRhn` — the source deposit is the Solana program's
 *   `deposit_to_reserve`, and that instruction carries NO route
 *   discriminator: its only destination argument is `glc_address`, the
 *   opaque bytes the payout step parses as a Goldcoin address (see
 *   `@/lib/solana/deposit`). A deposit built from this build would
 *   therefore fold as `SolToGlc` with a Robinhood `0x…` address in the
 *   Goldcoin destination slot — undeliverable, parked for manual review,
 *   with the deposit already made. Opening this route needs an on-chain
 *   instruction that names the route, not a frontend change.
 *
 * - `RhnToSol` — the custody contract DOES name the route
 *   (`CONTRACT_ROUTE_IDS.RhnToSol`, `0x04`), but `deposit()` takes
 *   `bytes destination` and deliberately never parses it: what the bytes
 *   MEAN is fixed by the route, at fold time, by the service. This build
 *   has a verified encoding for exactly one of those meanings — the UTF-8
 *   text of a Goldcoin P2PKH address, read off
 *   `validate_goldcoin_destination` (see `@/lib/evm/destination`). No
 *   equivalent has been read for a Solana destination, and the contract
 *   accepts any 1..64 bytes without complaint, so a guess is not refused
 *   on-chain — it is accepted, and the GLC is locked.
 *
 * # Opening a route here
 *
 * Flip its entry to `null` once the missing piece exists. Nothing else in
 * the UI has to change: the route is already named, priced, limited,
 * quoted and status-carded through the same data-driven tables as the
 * other four.
 */

/**
 * Why this build cannot start a route, or `null` when it can.
 *
 * The copy is end-user facing and says three things in order: that the
 * route exists, that this app cannot start it, and that nothing has moved.
 * It never blames the backend — the backend is not the thing refusing.
 */
const NOT_EXECUTABLE_HERE: Readonly<Record<SettlementRoute, string | null>> = {
  GlcToSol: null,
  SolToGlc: null,
  GlcToRhn: null,
  RhnToGlc: null,
  SolToRhn:
    "This app cannot start a Solana → Robinhood Network transfer yet. The route is live " +
    "on the bridge, but the Solana deposit instruction this app can build does not carry " +
    "a Robinhood destination, so nothing is submitted rather than sending a deposit that " +
    "could not be paid out.",
  RhnToSol:
    "This app cannot start a Robinhood Network → Solana transfer yet. The route is live " +
    "on the bridge, but this app has no confirmed encoding for a Solana destination in " +
    "the custody contract's deposit payload, so nothing is submitted rather than sending " +
    "a deposit that could not be paid out.",
};

export type RouteExecutionSupport =
  /** This build can build and submit the source transaction for this route. */
  | { readonly kind: "supported" }
  /**
   * The route is real and may well be open; this build cannot construct
   * its source transaction. `reason` is rendered verbatim.
   */
  | { readonly kind: "unsupported-here"; readonly reason: string };

export function routeExecutionSupport(route: Route): RouteExecutionSupport {
  const reason = NOT_EXECUTABLE_HERE[route];
  return reason === null ? { kind: "supported" } : { kind: "unsupported-here", reason };
}

/** The narrow form, for a caller that only needs the boolean. */
export function isRouteExecutableHere(route: Route): boolean {
  return NOT_EXECUTABLE_HERE[route] === null;
}

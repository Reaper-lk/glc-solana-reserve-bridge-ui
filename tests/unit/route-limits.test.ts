import { describe, expect, it } from "vitest";
import { perTransferCeiling, routeForPair } from "@/lib/bridge";
import { CHAIN_DESCRIPTORS } from "@/lib/bridge";

/**
 * Which chain's published per-transfer ceiling bounds a route.
 *
 * # The bug this table replaced
 *
 * The bridge form decided it inline: `GET /limits` governs the pair iff
 * neither side is Robinhood, otherwise the custody contract does. That held
 * while Robinhood only ever paired with Goldcoin. It stopped holding on the
 * cross routes, where BOTH chains publish a ceiling — a `SolToRhn` transfer
 * is bounded by the Solana program on the way in and by the contract on the
 * way out — and the inline `!== "robinhood"` test called `SolToRhn`
 * Robinhood-legged and dropped the bound that actually applies to the
 * deposit.
 *
 * # The rule
 *
 * The ceiling shown is the one the SOURCE chain enforces on the deposit,
 * falling through to the destination's payout ceiling when the source
 * publishes none. Goldcoin publishes none — there is no per-transfer ceiling
 * on sending to a deposit address — so both Goldcoin-sourced routes fall
 * through.
 */

/** Every route, with the ceiling that bounds it, stated independently. */
const EXPECTED = [
  // Goldcoin source: no source-side ceiling, so the destination's payout one.
  ["goldcoin", "solana", "GlcToSol", "solana-program"],
  ["goldcoin", "robinhood", "GlcToRhn", "robinhood-contract"],
  // Solana source: the program bounds what is deposited into it, whichever
  // reserve eventually pays the route out.
  ["solana", "goldcoin", "SolToGlc", "solana-program"],
  ["solana", "robinhood", "SolToRhn", "solana-program"],
  // Robinhood source: the contract's `inboundMax` bounds every deposit.
  ["robinhood", "goldcoin", "RhnToGlc", "robinhood-contract"],
  ["robinhood", "solana", "RhnToSol", "robinhood-contract"],
] as const;

describe("perTransferCeiling — one ceiling per route, stated once", () => {
  it.each(EXPECTED)(
    "%s -> %s (%s) is bounded by %s",
    (source, destination, _route, ceiling) => {
      expect(perTransferCeiling(source, destination)).toBe(ceiling);
    },
  );

  it("covers every pair the route table defines, with no gaps", () => {
    // A route with no ceiling would leave the form enforcing none and the
    // status card printing none — silently, and indistinguishably from a
    // backend that published none.
    for (const [source, destination] of EXPECTED) {
      expect(routeForPair(source, destination)).not.toBeNull();
      expect(perTransferCeiling(source, destination)).not.toBeNull();
    }
  });

  it("gives each cross route its SOURCE chain's ceiling, not its destination's", () => {
    // The specific inline-boolean bug. `SolToRhn` deposits into the Solana
    // program, so the program's `per_transfer_limit` is what bounds what a
    // user may submit — not the contract's `outboundMax`, which bounds the
    // payout on the far side in a different unit.
    expect(perTransferCeiling("solana", "robinhood")).toBe("solana-program");
    // And the mirror: `RhnToSol` deposits into the custody contract, so
    // `inboundMax` bounds it — not the Solana program's figure, even though
    // Solana is where it settles.
    expect(perTransferCeiling("robinhood", "solana")).toBe("robinhood-contract");
  });

  it("never shows a combined or converted figure", () => {
    // Both chains bound a cross route, in different units, and the backend
    // publishes no combined number. Taking a minimum across them would put a
    // figure on screen that no endpoint stated and no chain enforces as
    // written — so exactly one named source comes back, never a pair.
    expect(typeof perTransferCeiling("solana", "robinhood")).toBe("string");
    expect(typeof perTransferCeiling("robinhood", "solana")).toBe("string");
  });
});

describe("perTransferCeiling — failing closed", () => {
  it("claims no ceiling for a same-network pair", () => {
    for (const chain of CHAIN_DESCRIPTORS) {
      expect(perTransferCeiling(chain.id, chain.id)).toBeNull();
    }
  });

  it("claims no ceiling for a network it has never heard of", () => {
    expect(perTransferCeiling("goldcoin", "ethereum")).toBeNull();
    expect(perTransferCeiling("ethereum", "goldcoin")).toBeNull();
  });

  /**
   * The drift guard.
   *
   * `BridgeForm` reads this by chain id rather than by its resolved route —
   * a React Compiler constraint, documented where it happens — which makes
   * this table the second statement in the codebase of which pair is which.
   * A pair that resolves to a route and has no ceiling here, or the reverse,
   * means the form and /status can disagree about what a user may send.
   */
  it("answers for exactly the pairs resolveRoute answers for", () => {
    const ids = CHAIN_DESCRIPTORS.map((chain) => chain.id);
    expect(ids.length).toBeGreaterThan(2);
    for (const source of ids) {
      for (const destination of ids) {
        const hasRoute = routeForPair(source, destination) !== null;
        expect(perTransferCeiling(source, destination) !== null).toBe(hasRoute);
      }
    }
  });
});

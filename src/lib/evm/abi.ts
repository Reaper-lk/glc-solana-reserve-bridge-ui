/**
 * The exact slices of `GlcRobinhoodBridge` and ERC-20 this UI calls.
 *
 * Hand-written `const` ABI fragments rather than a generated artifact, and
 * deliberately minimal: this app only ever deposits, so it declares only
 * `deposit`, the reads that gate a deposit, and the four ERC-20 members an
 * approve-then-transfer flow needs. Nothing here can express a payout, a
 * refund, a settlement, a pause, or any governance action — those are
 * signer/operator operations, and an ABI entry for one would be a foothold
 * this page has no business having.
 *
 * Encoding is viem's job, not this file's. These fragments are typed with
 * `as const` so `encodeFunctionData`/`readContract` derive their argument
 * types from the ABI itself, which is what makes a wrong argument order or
 * a wrong type a COMPILE error rather than malformed calldata.
 */

/**
 * Route discriminators, mirroring `GlcRobinhoodBridge`'s `ROUTE_*`
 * constants exactly.
 *
 * These are a WIRE CONTRACT with deployed bytecode: never renumbered,
 * never reordered, and `0x00` is permanently invalid on both sides. The
 * backend keeps the same mapping in `Route::contract_route_id`. Changing
 * a value here without changing the deployed contract would authorize the
 * wrong route.
 */
export const CONTRACT_ROUTE_IDS = {
  GlcToRhn: 0x01,
  RhnToGlc: 0x02,
  SolToRhn: 0x03,
  RhnToSol: 0x04,
} as const;

/**
 * The two INBOUND routes — the ones `deposit()` accepts.
 *
 * `_routeLegs` models `ROUTE_RHN_TO_GLC` and `ROUTE_RHN_TO_SOL` as inbound
 * and the other two as payouts, and `deposit()` reverts with
 * `NotADepositRoute` on an outbound id. This table is the UI's copy of that
 * half of the contract's own model, so the one argument a deposit cannot
 * recover afterwards is chosen from a closed set rather than passed through
 * from somewhere else.
 *
 * Why the route must be named at all is the contract's own answer, quoted
 * because it is the whole reason this is not optional: "`destination` is
 * opaque bytes; a Goldcoin address and a Solana address are both just
 * bytes, and this contract cannot tell them apart… Leaving the route
 * implicit would mean the same call created two indistinguishable
 * obligations whose payouts belong on different networks — the depositor's
 * funds would be routed by guesswork."
 */
export const DEPOSIT_CONTRACT_ROUTE_IDS = {
  RhnToGlc: CONTRACT_ROUTE_IDS.RhnToGlc,
  RhnToSol: CONTRACT_ROUTE_IDS.RhnToSol,
} as const;

/** A route the custody contract will take a deposit for. */
export type DepositContractRoute = keyof typeof DEPOSIT_CONTRACT_ROUTE_IDS;
export type DepositContractRouteId =
  (typeof DEPOSIT_CONTRACT_ROUTE_IDS)[DepositContractRoute];

/** Whether a route name is one the contract accepts a deposit on. */
export function isDepositContractRoute(route: string): route is DepositContractRoute {
  return route in DEPOSIT_CONTRACT_ROUTE_IDS;
}

/**
 * The maximum destination payload the contract accepts
 * (`MAX_DESTINATION_LEN`), mirroring the Solana program's identical bound
 * on its own opaque `glc_address`. A Goldcoin Base58Check address is ~34
 * characters, so this is not a practical constraint — it is checked
 * because the contract checks it, and reverting is a worse way to learn.
 */
export const MAX_DESTINATION_LEN = 64;

export const glcRobinhoodBridgeAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "route", type: "uint8" },
      { name: "amount", type: "uint256" },
      { name: "destination", type: "bytes" },
    ],
    outputs: [{ name: "index", type: "uint256" }],
  },
  {
    // Every gate at once — not migrated, route enabled, direction not
    // paused, no migration committed. The contract's own docs say to read
    // THIS rather than reassembling it from the individual flags, "which
    // is where the two gates get confused for each other".
    type: "function",
    name: "isRouteLive",
    stateMutability: "view",
    inputs: [{ name: "route", type: "uint8" }],
    outputs: [{ type: "bool" }],
  },
  {
    // The REAL per-transfer bounds, read from the contract that enforces
    // them. The public bridge API does not expose these: `GET /limits`
    // carries the Solana program's `BridgeConfig` values, which govern a
    // different reserve on a different chain and must never be shown as
    // if they were Robinhood's.
    type: "function",
    name: "limits",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "inboundMin", type: "uint256" },
          { name: "inboundMax", type: "uint256" },
          { name: "inboundRollingLimit", type: "uint256" },
          { name: "outboundMin", type: "uint256" },
          { name: "outboundMax", type: "uint256" },
          { name: "outboundRollingLimit", type: "uint256" },
          { name: "protectedMinReserve", type: "uint256" },
        ],
      },
    ],
  },
  {
    // Read once before a deposit to confirm the configured contract holds
    // the configured token. A mismatch means this deployment's two
    // addresses disagree, and the approve would be granted on a token the
    // contract will never pull.
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    // Read, never assumed. 18 decimals is what makes Robinhood amounts a
    // separate unit at all, so a token reporting anything else is not the
    // asset this code models — the deposit is refused rather than scaled.
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

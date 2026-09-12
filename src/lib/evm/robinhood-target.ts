import type { Address } from "viem";

/**
 * The ONE place this build says which Robinhood Network deployment a
 * production transaction may target.
 *
 * # Why these are constants and not configuration
 *
 * They used to be configuration alone. `NEXT_PUBLIC_ROBINHOOD_CHAIN_ID`
 * and `NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS` were read, checked for
 * presence, and otherwise believed — so a deployment pointed at the
 * RETIRED V1 custody contract would have built, signed and broadcast a
 * perfectly well-formed deposit into it. The contract would have taken
 * the GLC. Nothing downstream indexes V1 any more, so the deposit would
 * never fold into a bridge request and never pay out: an unrecoverable
 * loss caused by one stale environment variable, invisible until after
 * the user had signed.
 *
 * Presence is not correctness. So the expected chain and the expected
 * contract are compiled in, and configuration is checked AGAINST them
 * rather than trusted as them. An env var that disagrees does not
 * override this file — it fails the deployment closed, which is the only
 * safe reading of "we cannot tell which bridge this is".
 *
 * # No fallback, in either direction
 *
 * There is deliberately no "try V2, else V1" path, no V1 entry in any
 * table a resolver walks, and no way to select V1 by configuration. V1
 * appears in this module exactly once, as a DENYLIST entry whose only
 * purpose is to name the retired contract in the refusal message — a
 * misconfiguration the operator can act on, rather than the generic
 * "unexpected address" they would otherwise get. It is never a target.
 *
 * # What this module does not decide
 *
 * Nothing here says a route is OPEN. Resolving a target means this UI has
 * identified the right contract on the right chain; whether it may be used
 * is decided by `GET /chains`' `available`, by the contract's own
 * `isRouteLive`, and by the rolling-24h wallet eligibility the backend
 * publishes. Those are separate gates and all of them still apply.
 */

/**
 * Robinhood Network's EIP-155 chain id.
 *
 * Asserted before signing, not merely compared once at render: a wallet
 * can be switched to another network in the moment between a button
 * enabling and a click landing, and a deposit signed for the wrong chain
 * is either replayable or simply lost.
 */
export const ROBINHOOD_CHAIN_ID = 4663;

/**
 * `GlcRobinhoodBridge` **V2** — the active custody contract, and the only
 * bridge address a production transaction from this build may name.
 *
 * Stored in its EIP-55 checksummed spelling; every comparison here is
 * case-insensitive, because an env var, a block explorer and a wallet all
 * legitimately spell the same 20 bytes differently.
 */
export const ROBINHOOD_V2_BRIDGE_ADDRESS =
  "0xbaEdFFdAC19fC9c1F025f8F6F74e633aB2708DBf" as const;

/**
 * `GlcRobinhoodBridge` **V1** — RETIRED. Present only so a deployment
 * still pointed at it gets a refusal that names the problem.
 *
 * This is not a fallback and not an alternative target. Nothing in this
 * codebase may send to it, and there is no configuration that makes it
 * selectable.
 */
export const ROBINHOOD_V1_BRIDGE_ADDRESS =
  "0x1753dDA0256A2cB10B44497ACeA9650A1422f440" as const;

/** Why a configured Robinhood target may not be used. */
export type RobinhoodTargetProblem =
  /** No bridge address configured at all. */
  | "bridge-address-missing"
  /** No chain id configured at all. */
  | "chain-id-missing"
  /** The configured address is the retired V1 custody contract. */
  | "bridge-address-retired-v1"
  /** The configured address is neither V2 nor V1 — an unknown contract. */
  | "bridge-address-unexpected"
  /** The configured chain is not Robinhood Network. */
  | "chain-id-unexpected";

export type RobinhoodTargetResult =
  | {
      readonly ok: true;
      /** V2, in its checksummed spelling — never the env var's spelling. */
      readonly bridgeAddress: Address;
      readonly chainId: typeof ROBINHOOD_CHAIN_ID;
    }
  | {
      readonly ok: false;
      readonly problem: RobinhoodTargetProblem;
      /** User-facing, and specific enough for an operator to act on. */
      readonly message: string;
    };

/** Case-insensitive 20-byte address equality. */
export function isSameEvmAddress(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Whether an address is the active V2 custody contract. */
export function isRobinhoodV2BridgeAddress(address: string | null | undefined): boolean {
  return isSameEvmAddress(address, ROBINHOOD_V2_BRIDGE_ADDRESS);
}

/** Whether an address is the retired V1 custody contract. */
export function isRetiredRobinhoodV1BridgeAddress(
  address: string | null | undefined,
): boolean {
  return isSameEvmAddress(address, ROBINHOOD_V1_BRIDGE_ADDRESS);
}

const CONFIGURATION_PROBLEM_NEXT =
  "This is a deployment configuration problem, not something you can fix — please report it.";

/**
 * Checks a configured Robinhood target against the pinned V2 deployment.
 *
 * Every refusal is total: there is no partial success, no "usable for
 * reads only", and no degraded mode. A target this function does not
 * return `ok: true` for is one no transaction may name.
 *
 * Ordering is deliberate. Missing configuration is reported before wrong
 * configuration, because an operator who has set nothing needs different
 * instructions from one who has set the wrong thing; and the retired-V1
 * case is reported before the generic unexpected-address case, because it
 * is the one misconfiguration with a known, nameable cause.
 */
export function checkRobinhoodTarget(config: {
  readonly bridgeAddress: string | undefined;
  readonly chainId: number | undefined;
}): RobinhoodTargetResult {
  const { bridgeAddress, chainId } = config;

  if (bridgeAddress === undefined || bridgeAddress.trim() === "") {
    return {
      ok: false,
      problem: "bridge-address-missing",
      message: `No Robinhood Network bridge contract is configured for this deployment. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }
  if (chainId === undefined) {
    return {
      ok: false,
      problem: "chain-id-missing",
      message: `No Robinhood Network chain id is configured for this deployment. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }
  if (isRetiredRobinhoodV1BridgeAddress(bridgeAddress)) {
    return {
      ok: false,
      problem: "bridge-address-retired-v1",
      message: `This deployment is configured with the RETIRED V1 Robinhood bridge contract (${ROBINHOOD_V1_BRIDGE_ADDRESS}). Deposits to it are never settled. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }
  if (!isRobinhoodV2BridgeAddress(bridgeAddress)) {
    return {
      ok: false,
      problem: "bridge-address-unexpected",
      message: `This deployment is configured with an unrecognised Robinhood bridge contract (${bridgeAddress}). ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    return {
      ok: false,
      problem: "chain-id-unexpected",
      message: `This deployment is configured for chain id ${chainId}, but the Robinhood bridge contract lives on chain ${ROBINHOOD_CHAIN_ID}. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }

  return {
    // The PINNED spelling, not the configured one. Whatever casing the
    // env var used, everything downstream — calldata, allowance checks,
    // the `spender` a user approves — sees one canonical value.
    ok: true,
    bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS as Address,
    chainId: ROBINHOOD_CHAIN_ID,
  };
}

/**
 * The message shown when a wallet is on the wrong network at SIGNING
 * time — not at render time, where `robinhoodDepositCapability` already
 * has its own copy.
 */
export function wrongChainMessage(actual: number | null): string {
  const on = actual === null ? "an unknown network" : `chain id ${actual}`;
  return `Your wallet is on ${on}, but this transfer must be signed on Robinhood Network (chain id ${ROBINHOOD_CHAIN_ID}). Switch networks in your wallet and try again — nothing has been sent.`;
}

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

/**
 * The ERC-20 GLC token the V2 custody contract holds, 18 decimals.
 *
 * Pinned for the same reason the bridge address is: it is a fixed
 * property of the production deployment, not a per-environment choice,
 * and a deployment missing it used to disable the whole Robinhood surface
 * — including connecting a wallet, which does not involve the token at
 * all.
 *
 * Still verified against the chain before a deposit:
 * `preflightRobinhoodDeposit` reads the contract's own `token()` and the
 * token's own `decimals()` and refuses on a mismatch. Pinning decides
 * which token this build is ABOUT; the chain decides whether that is
 * true.
 */
export const ROBINHOOD_GLC_TOKEN_ADDRESS =
  "0xaf0172DDEa4ce60dB3EBab05748A00B14fC8e433" as const;

/**
 * Robinhood Network's public JSON-RPC endpoint — the default when no
 * `NEXT_PUBLIC_ROBINHOOD_RPC_URL` is configured.
 *
 * # Why this one has a default and the addresses have a pin
 *
 * They are different kinds of value. A wrong contract address sends real
 * GLC somewhere that will never settle, so it is pinned and any
 * disagreement fails closed. An RPC endpoint is only where READS go: the
 * chain id is asserted against the wallet itself before signing, the
 * transaction is signed for the pinned contract on the pinned chain, and
 * the contract re-checks every gate on execution. A wrong or unreachable
 * RPC can therefore make preflight fail or pass when it should not — it
 * cannot redirect funds.
 *
 * So an absent RPC is not a safety problem, and treating it as one is
 * what disabled wallet connection on a deployment that had simply not set
 * an optional variable. An operator may still override it; this is the
 * value used when nobody has.
 */
export const ROBINHOOD_DEFAULT_RPC_URL =
  "https://rpc.mainnet.chain.robinhood.com" as const;

/** The chain's display name, used in wallet prompts and copy. */
export const ROBINHOOD_CHAIN_NAME = "Robinhood Network" as const;

/** Why a configured Robinhood target may not be used. */
export type RobinhoodTargetProblem =
  /** The configured address is the retired V1 custody contract. */
  | "bridge-address-retired-v1"
  /** The configured address is neither V2 nor V1 — an unknown contract. */
  | "bridge-address-unexpected"
  /** The configured chain is not Robinhood Network. */
  | "chain-id-unexpected"
  /** The configured token is not the one the V2 contract holds. */
  | "token-address-unexpected";

export type RobinhoodTargetResult =
  | {
      readonly ok: true;
      /** V2, in its checksummed spelling — never the env var's spelling. */
      readonly bridgeAddress: Address;
      readonly chainId: typeof ROBINHOOD_CHAIN_ID;
      /** The pinned GLC token, likewise in its own canonical spelling. */
      readonly tokenAddress: Address;
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
 * Checks configuration against the pinned V2 deployment.
 *
 * # Configuration is an optional OVERRIDE, not a requirement
 *
 * Every value this returns is pinned, so there is nothing a deployment
 * has to supply for it to resolve. An env var that is absent is simply
 * the pin; an env var that is PRESENT must agree with the pin, and any
 * disagreement fails closed with the reason named.
 *
 * That distinction is the fix for a real production failure. Requiring
 * the bridge address and the chain id from the environment — after both
 * had been pinned in code — meant an unset or stale variable disabled the
 * entire Robinhood surface, including connecting a wallet, which involves
 * neither the contract nor the chain id nor the token. Presence was
 * standing in for correctness on values whose correctness is already
 * known at compile time.
 *
 * Nothing about the safety posture changes by removing it: V1 is still
 * denylisted by name, an unrecognised contract is still refused, a wrong
 * chain is still refused, and the value that reaches calldata is still
 * the PIN rather than whatever the environment spelled. What is gone is
 * the case where saying nothing was treated as saying something wrong.
 *
 * Ordering is deliberate: the retired-V1 case is reported before the
 * generic unexpected-address case, because it is the one
 * misconfiguration with a known, nameable cause and a known consequence.
 */
export function checkRobinhoodTarget(
  config: {
    readonly bridgeAddress?: string | undefined;
    readonly chainId?: number | undefined;
    readonly tokenAddress?: string | undefined;
  } = {},
): RobinhoodTargetResult {
  const { bridgeAddress, chainId, tokenAddress } = config;

  // `undefined` and blank both mean "not configured", which is now a
  // legitimate state: the pin answers for it.
  const configuredBridge =
    bridgeAddress === undefined || bridgeAddress.trim() === ""
      ? undefined
      : bridgeAddress.trim();
  const configuredToken =
    tokenAddress === undefined || tokenAddress.trim() === ""
      ? undefined
      : tokenAddress.trim();

  if (configuredBridge !== undefined) {
    if (isRetiredRobinhoodV1BridgeAddress(configuredBridge)) {
      return {
        ok: false,
        problem: "bridge-address-retired-v1",
        message: `This deployment is configured with the RETIRED V1 Robinhood bridge contract (${ROBINHOOD_V1_BRIDGE_ADDRESS}). Deposits to it are never settled. ${CONFIGURATION_PROBLEM_NEXT}`,
      };
    }
    if (!isRobinhoodV2BridgeAddress(configuredBridge)) {
      return {
        ok: false,
        problem: "bridge-address-unexpected",
        message: `This deployment is configured with an unrecognised Robinhood bridge contract (${configuredBridge}). ${CONFIGURATION_PROBLEM_NEXT}`,
      };
    }
  }
  if (chainId !== undefined && chainId !== ROBINHOOD_CHAIN_ID) {
    return {
      ok: false,
      problem: "chain-id-unexpected",
      message: `This deployment is configured for chain id ${chainId}, but the Robinhood bridge contract lives on chain ${ROBINHOOD_CHAIN_ID}. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }
  if (
    configuredToken !== undefined &&
    !isSameEvmAddress(configuredToken, ROBINHOOD_GLC_TOKEN_ADDRESS)
  ) {
    return {
      ok: false,
      problem: "token-address-unexpected",
      message: `This deployment is configured with an unrecognised Robinhood GLC token (${configuredToken}); the bridge contract holds ${ROBINHOOD_GLC_TOKEN_ADDRESS}. ${CONFIGURATION_PROBLEM_NEXT}`,
    };
  }

  return {
    // The PINNED spellings, never the configured ones. Whatever casing an
    // env var used, everything downstream — calldata, allowance checks,
    // the `spender` a user approves — sees one canonical value.
    ok: true,
    bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS as Address,
    chainId: ROBINHOOD_CHAIN_ID,
    tokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS as Address,
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

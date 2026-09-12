import type { Address } from "viem";
import { env } from "@/lib/config/env";
import {
  checkRobinhoodTarget,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_CHAIN_NAME,
  ROBINHOOD_DEFAULT_RPC_URL,
  type RobinhoodTargetProblem,
  type RobinhoodTargetResult,
} from "./robinhood-target";

/**
 * The Robinhood Network deployment this build talks to.
 *
 * # Two questions, deliberately not one
 *
 * {@link robinhoodNetwork} is the network identity — chain id, name, RPC
 * — and it ALWAYS resolves, because every part of it is pinned or
 * defaulted. It is what connecting a wallet needs, and connecting a
 * wallet touches no contract.
 *
 * {@link resolveRobinhoodDeployment} adds the two addresses a transaction
 * names, and refuses when configuration DISAGREES with a pin.
 *
 * Collapsing the two is what broke production. `robinhoodDeployment()`
 * demanded four environment variables and returned `null` if any was
 * absent; the wallet control read that `null` as "Robinhood Network is
 * not configured for this deployment" and offered no connect button — on
 * a chain whose id, contract and token are compile-time constants, over
 * an optional RPC URL and an optional token address that the pins
 * already answer for.
 *
 * # Configuration is checked, never believed
 *
 * `./robinhood-target` compiles in the chain id, the custody contract and
 * the token. Configuration may only AGREE with them: the retired V1
 * contract is denylisted by name, an unrecognised contract is refused, a
 * wrong chain is refused, a token the contract does not hold is refused,
 * and the value that reaches calldata is always the pin rather than
 * whatever an env var spelled.
 *
 * What is NOT refused any more is silence. An absent optional variable
 * means "use the pin", because presence was never what made these values
 * correct.
 *
 * # Configured is still not open
 *
 * Resolving anything here says this UI COULD build a deposit. Whether it
 * may is decided elsewhere and always: by `GET /chains`' `available` for
 * the route, by the backend's rolling-24h wallet eligibility, and — for
 * anything that actually touches the contract — by the contract's own
 * `isRouteLive`, read live immediately before use. Nothing in this file
 * is an availability signal, and nothing in this file is affected by a
 * route being paused.
 */

export interface RobinhoodDeployment {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly bridgeAddress: Address;
  readonly tokenAddress: Address;
}

/**
 * The deposit deployment, in full — resolved on success, the named
 * problem on failure.
 *
 * Exported alongside `robinhoodDeployment` because the two answer
 * different questions. Callers that only need "can this route run" want
 * the `null` that `robinhoodDeployment` gives them; callers that must
 * TELL a user why need the reason, and reconstructing it from `null`
 * would mean re-implementing the check.
 */
export type RobinhoodDeploymentResolution =
  | { readonly ok: true; readonly deployment: RobinhoodDeployment }
  | {
      readonly ok: false;
      readonly problem: RobinhoodTargetProblem;
      readonly message: string;
    };

/**
 * The NETWORK IDENTITY — everything needed to connect a wallet and, if it
 * has never heard of this chain, to offer to add it.
 *
 * # Why this is separate from the deployment, and why it cannot fail
 *
 * Connecting a wallet touches no contract. It needs a chain id to compare
 * against, a name to show in the prompt, and an RPC URL for
 * `wallet_addEthereumChain` — and all three are pinned or defaulted, so
 * this always resolves.
 *
 * It is separate because conflating the two caused a production
 * regression: `robinhoodDeployment()` required four environment variables
 * and returned `null` if any was absent, and the wallet control read that
 * `null` as "this network is not configured here" and refused to offer a
 * connect button at all. A deployment that had simply not set an optional
 * token address or RPC URL therefore could not connect MetaMask — on a
 * chain whose id and contract are compile-time constants.
 *
 * Route state is likewise nothing to do with this. A paused or
 * unavailable route still connects a wallet; `GET /chains` gates the
 * transfer, and a user cannot be told why their wallet will not connect
 * when the real answer is that the route is closed.
 */
export interface RobinhoodNetwork {
  readonly chainId: typeof ROBINHOOD_CHAIN_ID;
  readonly chainName: string;
  readonly rpcUrl: string;
}

export function robinhoodNetwork(): RobinhoodNetwork {
  return {
    // The pin, never configuration. An env var may disagree with it —
    // which `resolveRobinhoodDeployment` refuses for the DEPOSIT — but a
    // wallet is always asked for the one chain this build is about.
    chainId: ROBINHOOD_CHAIN_ID,
    chainName: env.robinhoodChainName ?? ROBINHOOD_CHAIN_NAME,
    rpcUrl: env.robinhoodRpcUrl ?? ROBINHOOD_DEFAULT_RPC_URL,
  };
}

/**
 * The full deposit deployment: the network plus the two addresses a
 * transaction names.
 *
 * Resolves by default — every value is pinned or defaulted — and refuses
 * only when configuration explicitly DISAGREES with a pin. That is the
 * one remaining `null` case, and it is a real deployment fault worth
 * blocking a deposit on: a deployment naming the retired V1 contract, an
 * unrecognised contract, the wrong chain, or a token the contract does
 * not hold.
 *
 * All-or-nothing on purpose, as before: a partially-trusted deployment
 * that looked usable would fail at the wallet instead of at the form.
 */
export function resolveRobinhoodDeployment(): RobinhoodDeploymentResolution {
  const target: RobinhoodTargetResult = checkRobinhoodTarget({
    bridgeAddress: env.robinhoodBridgeAddress,
    chainId: env.robinhoodChainId,
    tokenAddress: env.robinhoodTokenAddress,
  });
  if (!target.ok) {
    return { ok: false, problem: target.problem, message: target.message };
  }
  const network = robinhoodNetwork();
  return {
    ok: true,
    deployment: {
      // From the PIN, not from configuration. Configuration agreed with
      // it or we never reached this line, so carrying an env var's own
      // spelling forward would only create a second one free to drift.
      chainId: target.chainId,
      chainName: network.chainName,
      rpcUrl: network.rpcUrl,
      bridgeAddress: target.bridgeAddress,
      tokenAddress: target.tokenAddress,
    },
  };
}

/**
 * The resolved deployment, or `null` when configuration disagrees with a
 * pin.
 *
 * Unchanged signature, deliberately: every caller already fails closed on
 * `null`. What changed is which inputs produce one — an absent optional
 * variable no longer does.
 */
export function robinhoodDeployment(): RobinhoodDeployment | null {
  const resolution = resolveRobinhoodDeployment();
  return resolution.ok ? resolution.deployment : null;
}

/**
 * Why the deployment did not resolve, or `null` when it did — so a form
 * can name a retired or unrecognised contract instead of saying the
 * generic "not configured".
 */
export function robinhoodDeploymentProblem(): string | null {
  const resolution = resolveRobinhoodDeployment();
  return resolution.ok ? null : resolution.message;
}

export function isRobinhoodDeploymentConfigured(): boolean {
  return robinhoodDeployment() !== null;
}

export type RobinhoodDepositReason =
  | "deployment-unconfigured"
  | "no-injected-wallet"
  | "wallet-disconnected"
  | "wrong-chain"
  | "route-not-open"
  | "amount-not-canonical"
  | "destination-invalid";

export interface RobinhoodDepositCapability {
  readonly available: boolean;
  readonly reason: RobinhoodDepositReason | null;
  readonly message: string | null;
}

const AVAILABLE: RobinhoodDepositCapability = {
  available: true,
  reason: null,
  message: null,
};

export interface RobinhoodDepositContext {
  readonly deployment: RobinhoodDeployment | null;
  /** Whether the browser exposes any EIP-1193 provider at all. */
  readonly injectedWalletAvailable: boolean;
  readonly walletConnected: boolean;
  /** The chain the connected wallet is currently on, or null when unknown. */
  readonly connectedChainId: number | null;
  /**
   * `robinhoodDeploymentProblem()` — why `deployment` is `null`, when it
   * is. Optional: a caller that does not supply it gets the generic
   * "not configured" sentence, which is correct but less actionable than
   * "this deployment names the retired V1 contract".
   */
  readonly deploymentProblem?: string | null;
  /** `GET /chains`' verdict for `RhnToGlc`. Never re-derived locally. */
  readonly routeOpen: boolean;
  /** Whether the entered amount is an exact multiple of the contract's canonical scale. */
  readonly amountIsCanonical: boolean;
  /** Whether the Goldcoin destination validated and encoded. */
  readonly destinationValid: boolean;
}

/**
 * Every reason a Robinhood deposit cannot be built right now, in the order
 * a user can act on them. Ordering matters: telling someone to switch
 * networks before telling them the route is closed would send them
 * through a wallet prompt for nothing.
 */
export function robinhoodDepositCapability(
  context: RobinhoodDepositContext,
): RobinhoodDepositCapability {
  if (!context.deployment) {
    return {
      available: false,
      reason: "deployment-unconfigured",
      // The specific cause when the caller knows it — a retired V1
      // address and an unset variable are both "unconfigured" to this
      // function and completely different problems to an operator.
      message:
        context.deploymentProblem ??
        "Robinhood Network transfers are not configured for this deployment, so this route cannot be used here.",
    };
  }
  if (!context.routeOpen) {
    return {
      available: false,
      reason: "route-not-open",
      message: "This route is not open for transfers right now.",
    };
  }
  if (!context.injectedWalletAvailable) {
    return {
      available: false,
      reason: "no-injected-wallet",
      message:
        "No browser wallet was detected. Install an EVM wallet extension to deposit from Robinhood Network.",
    };
  }
  if (!context.walletConnected) {
    return {
      available: false,
      reason: "wallet-disconnected",
      message: "Connect a Robinhood Network wallet to deposit.",
    };
  }
  // Against the PIN, not against `deployment.chainId`. The two are equal
  // by construction today — `resolveRobinhoodDeployment` refuses any other
  // chain — and naming the constant here means this check cannot be
  // weakened by a future change to how the deployment is assembled. The
  // signing path re-asserts the same number against the live wallet, since
  // a network can be switched between this render and that click.
  if (context.connectedChainId !== ROBINHOOD_CHAIN_ID) {
    return {
      available: false,
      reason: "wrong-chain",
      message: `Your wallet is on the wrong network. Switch it to ${context.deployment.chainName} (chain id ${ROBINHOOD_CHAIN_ID}) to continue.`,
    };
  }
  if (!context.destinationValid) {
    return {
      available: false,
      reason: "destination-invalid",
      message: "Enter a valid Goldcoin destination address.",
    };
  }
  if (!context.amountIsCanonical) {
    return {
      available: false,
      reason: "amount-not-canonical",
      message:
        "That amount has more decimal places than the bridge can settle. The contract rejects it rather than rounding.",
    };
  }
  return AVAILABLE;
}

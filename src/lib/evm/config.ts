import type { Address } from "viem";
import { env } from "@/lib/config/env";
import {
  checkRobinhoodTarget,
  ROBINHOOD_CHAIN_ID,
  type RobinhoodTargetProblem,
  type RobinhoodTargetResult,
} from "./robinhood-target";

/**
 * The Robinhood Network deployment this build talks to — resolved only
 * when configuration agrees with the PINNED V2 target.
 *
 * # Configuration is checked, never believed
 *
 * `./robinhood-target` compiles in the one chain id and the one custody
 * contract a production transaction may name. This module's job is to
 * refuse everything else: an unset variable, the retired V1 contract, an
 * unrecognised address, the wrong chain. Every one of those resolves to
 * `null` here, which every caller already treats as "this route cannot be
 * used", so a misconfigured deployment disables the Robinhood routes
 * instead of signing into the wrong contract.
 *
 * There is no default, no well-known address, and no "probably this
 * chain" fallback — and, specifically, no path by which a V2 miss falls
 * back to V1. A guessed chain id signs a transaction for the wrong
 * network; a wrong contract address sends real GLC somewhere that will
 * never settle. Both are unrecoverable, and neither failure is visible
 * until after the user has signed.
 *
 * # Configured is still not open
 *
 * Resolving a deployment says this UI COULD build a deposit. Whether it
 * may is decided elsewhere and always: by `GET /chains`' `available` for
 * the route, by the backend's rolling-24h wallet eligibility, and — for
 * anything that actually touches the contract — by the contract's own
 * `isRouteLive`, read live immediately before use. Nothing in this file is
 * an availability signal.
 */

export interface RobinhoodDeployment {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly bridgeAddress: Address;
  readonly tokenAddress: Address;
}

/**
 * The configured target checked against the pinned V2 deployment, in full
 * — the resolved deployment on success, the named problem on failure.
 *
 * Exported alongside `robinhoodDeployment` because the two answer
 * different questions. Callers that only need "can this route run"
 * (every gate, every capability check) want the `null` that
 * `robinhoodDeployment` gives them. Callers that must TELL a user why
 * need the reason, and reconstructing it from `null` would mean
 * re-implementing the check.
 *
 * All-or-nothing on purpose: a chain id without a contract address, or a
 * contract without the token it holds, cannot produce a valid deposit, and
 * a partially-configured deployment that looked usable would fail at the
 * wallet instead of at the form.
 */
export type RobinhoodDeploymentResolution =
  | { readonly ok: true; readonly deployment: RobinhoodDeployment }
  | {
      readonly ok: false;
      readonly problem: RobinhoodTargetProblem | "rpc-url-missing" | "token-missing";
      readonly message: string;
    };

export function resolveRobinhoodDeployment(): RobinhoodDeploymentResolution {
  const {
    robinhoodChainId,
    robinhoodRpcUrl,
    robinhoodBridgeAddress,
    robinhoodTokenAddress,
  } = env;

  // The pinned target first: an operator pointed at the wrong contract
  // needs to hear THAT, not that their RPC URL is also unset.
  const target: RobinhoodTargetResult = checkRobinhoodTarget({
    bridgeAddress: robinhoodBridgeAddress,
    chainId: robinhoodChainId,
  });
  if (!target.ok) {
    return { ok: false, problem: target.problem, message: target.message };
  }
  if (robinhoodRpcUrl === undefined) {
    return {
      ok: false,
      problem: "rpc-url-missing",
      message:
        "No Robinhood Network RPC endpoint is configured for this deployment, so the pre-deposit checks cannot run. This is a deployment configuration problem, not something you can fix — please report it.",
    };
  }
  if (robinhoodTokenAddress === undefined) {
    return {
      ok: false,
      problem: "token-missing",
      message:
        "No Robinhood Network GLC token address is configured for this deployment. This is a deployment configuration problem, not something you can fix — please report it.",
    };
  }

  return {
    ok: true,
    deployment: {
      // From the PIN, not from configuration. Configuration agreed with
      // it or we never reached this line, so carrying the env var's own
      // values forward would only create a second spelling free to drift.
      chainId: target.chainId,
      chainName: env.robinhoodChainName ?? "Robinhood Network",
      rpcUrl: robinhoodRpcUrl,
      bridgeAddress: target.bridgeAddress,
      tokenAddress: robinhoodTokenAddress as Address,
    },
  };
}

/**
 * The resolved deployment, or `null` when configuration is missing OR
 * disagrees with the pinned V2 target.
 *
 * Unchanged signature, deliberately: every existing caller already fails
 * closed on `null`, so pinning the target tightened all of them at once
 * without a single call site having to opt in.
 */
export function robinhoodDeployment(): RobinhoodDeployment | null {
  const resolution = resolveRobinhoodDeployment();
  return resolution.ok ? resolution.deployment : null;
}

/**
 * Why the deployment did not resolve, or `null` when it did — the message
 * a form shows in place of "not configured for this deployment" when the
 * real cause is a retired or unrecognised contract.
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

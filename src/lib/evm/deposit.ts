import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { evmConfirmationError, evmPreflightError, evmSendError } from "@/lib/api/errors";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";
import {
  DEPOSIT_CONTRACT_ROUTE_IDS,
  erc20Abi,
  glcRobinhoodBridgeAbi,
  type DepositContractRoute,
} from "./abi";
import type { RobinhoodDeployment } from "./config";
import {
  isRetiredRobinhoodV1BridgeAddress,
  isRobinhoodV2BridgeAddress,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_V1_BRIDGE_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
  wrongChainMessage,
} from "./robinhood-target";

/**
 * A Robinhood-sourced deposit — `RhnToGlc` or `RhnToSol`. The one place
 * this app writes to Robinhood Network.
 *
 * # Why the UI does this at all
 *
 * Neither route has a backend create-transfer endpoint, and that is a
 * deliberate backend design rather than a gap — the same design
 * `SolToGlc` already uses, and `POST /transfers` refuses both by name
 * ("route RhnToSol is not created through this endpoint"). The depositor
 * calls the custody contract directly, and the service's indexer observes
 * the resulting `DepositCreated` event and folds it into a bridge request.
 * There is no request id to hold until the chain has one.
 *
 * # The route is an argument, not an assumption
 *
 * `deposit(route, amount, destination)` takes the route explicitly, and it
 * is the one thing about a deposit that cannot be recovered afterwards —
 * the destination is opaque bytes the contract never parses, so the route
 * is what says which network they name. Every function below therefore
 * takes the route from its caller; none carries a default, and the id comes
 * from `DEPOSIT_CONTRACT_ROUTE_IDS`, which holds only the two the contract
 * accepts a deposit on.
 *
 * # Everything checkable is checked before anything is signed
 *
 * The contract reverts on a closed route, a non-canonical amount, an
 * out-of-bounds amount, and an inexact transfer. A revert costs the user
 * a network fee and tells them nothing useful, so every one of those is
 * read first, over the deployment's own RPC, and refused with a real
 * reason. The reads can only make this stricter than the contract, never
 * more permissive: the contract re-checks all of it at execution time and
 * is the authority either way.
 *
 * # Approval is exact, never unlimited
 *
 * The allowance granted is exactly the deposit amount. An unlimited
 * approval would leave a standing claim on the user's balance long after
 * this one transfer, for no benefit to a flow that runs once.
 */

export interface RobinhoodDepositParams {
  readonly provider: EIP1193Provider;
  readonly deployment: RobinhoodDeployment;
  /**
   * Which inbound route this deposit is for. Decides the contract's `route`
   * argument AND what the service will parse `destination` as, so the two
   * must describe the same intent — the caller encodes the destination for
   * THIS route or not at all.
   */
  readonly route: DepositContractRoute;
  readonly account: Address;
  /** Robinhood atomic units (18 decimals). Must be an exact canonical multiple. */
  readonly amountRaw: bigint;
  /**
   * The ABI `bytes` destination payload, encoded for `route`'s destination
   * network: `encodeGoldcoinDestination` for `RhnToGlc`,
   * `encodeSolanaDestination` for `RhnToSol`. Never interchangeable — the
   * service parses these bytes by route, and a mismatch is accepted
   * on-chain and parked undeliverable with the deposit already made.
   */
  readonly destination: Hex;
  /** Progress callback, so the UI can narrate a two-transaction flow. */
  readonly onStep?: (step: RobinhoodDepositStep) => void;
}

export type RobinhoodDepositStep =
  "preflight" | "approving" | "approval-confirming" | "depositing" | "deposit-confirming";

export interface RobinhoodDepositResult {
  /** The deposit transaction's hash. Not the obligation index — that is read from the event by the backend's indexer. */
  readonly hash: Hex;
  /** The approval transaction's hash, when one was needed. */
  readonly approvalHash: Hex | null;
}

function publicClientFor(deployment: RobinhoodDeployment) {
  // The deployment's own RPC, not the wallet's. A wallet may be pointed at
  // any node; preflight answers that gate a signature should come from the
  // endpoint this deployment was configured with.
  return createPublicClient({ transport: http(deployment.rpcUrl) });
}

function walletClientFor(provider: EIP1193Provider, account: Address) {
  return createWalletClient({ account, transport: custom(provider) });
}

/**
 * The LAST check before any Robinhood transaction is built: this
 * deployment names the pinned V2 custody contract on the pinned chain.
 *
 * # Why it is repeated here
 *
 * `resolveRobinhoodDeployment` already refused everything else, so in a
 * correctly wired build this can never fire. It is asserted anyway,
 * inside the module that actually signs, because what it protects against
 * is not a misconfiguration but a WIRING mistake: a `RobinhoodDeployment`
 * assembled by some other path, a test double, a future caller that
 * builds the struct by hand. Every one of those bypasses the resolver,
 * and the failure mode is GLC sent to the retired V1 contract — accepted
 * on-chain, never indexed, never settled, never returned.
 *
 * V1 is named explicitly rather than folded into the generic mismatch
 * because it is the one wrong address with a known cause and a known
 * consequence, and an operator reading the error should not have to look
 * the address up.
 */
export function assertRobinhoodV2Target(deployment: RobinhoodDeployment): void {
  if (isRetiredRobinhoodV1BridgeAddress(deployment.bridgeAddress)) {
    throw evmPreflightError(
      `This transfer would have been sent to the RETIRED V1 Robinhood bridge contract (${ROBINHOOD_V1_BRIDGE_ADDRESS}), which never settles. Nothing was sent.`,
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }
  if (!isRobinhoodV2BridgeAddress(deployment.bridgeAddress)) {
    throw evmPreflightError(
      `This transfer would have been sent to ${deployment.bridgeAddress}, which is not the Robinhood bridge contract (${ROBINHOOD_V2_BRIDGE_ADDRESS}). Nothing was sent.`,
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }
  if (deployment.chainId !== ROBINHOOD_CHAIN_ID) {
    throw evmPreflightError(
      `This deployment is configured for chain id ${deployment.chainId}, but the Robinhood bridge contract lives on chain ${ROBINHOOD_CHAIN_ID}. Nothing was sent.`,
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }
}

/**
 * The connected wallet is on Robinhood Network RIGHT NOW, read from the
 * wallet itself rather than from React state.
 *
 * `robinhoodDepositCapability` compares the chain id the app last
 * OBSERVED, which is a render-time fact. A user can switch networks in
 * their wallet in the moment between the button enabling and the click
 * landing, and `writeContract` is called with `chain: null` — viem is
 * explicitly told not to assert a chain, so nothing else in the send path
 * would notice. This asks the provider directly, immediately before the
 * first write.
 *
 * A provider that cannot answer is a refusal, not a pass: "I could not
 * determine the network" and "the network is correct" are different
 * answers, and only one of them may authorize a signature.
 */
async function assertWalletOnRobinhoodChain(provider: EIP1193Provider): Promise<void> {
  let chainId: number | null = null;
  try {
    const raw = await provider.request({ method: "eth_chainId" });
    // EIP-1193 returns a hex quantity string; a provider returning a
    // number is tolerated rather than trusted blindly.
    const parsed = typeof raw === "string" ? Number.parseInt(raw, 16) : Number(raw);
    chainId = Number.isFinite(parsed) ? parsed : null;
  } catch {
    chainId = null;
  }
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw evmPreflightError(
      wrongChainMessage(chainId),
      chainId === null
        ? "If your wallet is already on Robinhood Network, reconnect it and try again."
        : `Switch your wallet to chain id ${ROBINHOOD_CHAIN_ID} and try again.`,
    );
  }
}

/**
 * Reads every gate the contract will apply, and refuses before signing if
 * any of them would fail. Exported for direct testing — the assertions
 * here are the difference between a clear refusal and a paid-for revert.
 */
export async function preflightRobinhoodDeposit(params: {
  readonly deployment: RobinhoodDeployment;
  /** The route whose `isRouteLive` is read. Each is gated independently on-chain. */
  readonly route: DepositContractRoute;
  readonly account: Address;
  readonly amountRaw: bigint;
}): Promise<void> {
  const { deployment, account, amountRaw } = params;
  // Before any RPC call: a read against the wrong contract is wasted, and
  // a read that SUCCEEDS against the wrong contract is worse — it would
  // report a live route and sane limits for a bridge nothing settles.
  assertRobinhoodV2Target(deployment);
  const client = publicClientFor(deployment);
  const route = DEPOSIT_CONTRACT_ROUTE_IDS[params.route];

  const [token, decimals, routeLive, limits, balance] = await Promise.all([
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "token",
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "isRouteLive",
      args: [route],
    }),
    client.readContract({
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "limits",
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
  ]);

  // The two configured addresses must agree with each other. If they do
  // not, an approval would be granted on a token this contract never
  // pulls — a standing allowance for nothing, and a deposit that reverts.
  if (token.toLowerCase() !== deployment.tokenAddress.toLowerCase()) {
    throw evmPreflightError(
      "The configured bridge contract holds a different token than this app is configured with.",
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }

  // 18 decimals is what makes Robinhood amounts a separate unit at all. A
  // token reporting anything else is not the asset this code models, so
  // the deposit is refused rather than rescaled to fit.
  if (Number(decimals) !== ROBINHOOD_DECIMALS) {
    throw evmPreflightError(
      `The configured token reports ${decimals} decimals, but this bridge requires ${ROBINHOOD_DECIMALS}.`,
      "This is a deployment configuration problem, not something you can fix — please report it.",
    );
  }

  if (!routeLive) {
    throw evmPreflightError(
      "The bridge contract is not currently accepting deposits on this route.",
      "This is set on-chain and can change without notice — check the status page, and try again later.",
    );
  }

  if (balance < amountRaw) {
    throw evmPreflightError(
      "Your wallet's GLC balance is lower than the amount you entered.",
      "Enter an amount you hold, or top up the wallet and try again.",
    );
  }

  // The contract's OWN limits, read from the contract that enforces them.
  // The public bridge API deliberately does not carry these — `GET /limits`
  // reports the Solana program's `BridgeConfig`, which bounds a different
  // reserve on a different chain.
  if (amountRaw < limits.inboundMin) {
    throw evmPreflightError(
      "That amount is below the bridge contract's minimum for this route.",
      "Enter a larger amount and try again.",
    );
  }
  if (amountRaw > limits.inboundMax) {
    throw evmPreflightError(
      "That amount is above the bridge contract's maximum for a single transfer on this route.",
      "Enter a smaller amount, or split the transfer.",
    );
  }
}

export async function depositToRobinhoodReserve(
  params: RobinhoodDepositParams,
): Promise<RobinhoodDepositResult> {
  const { provider, deployment, account, amountRaw, destination, onStep } = params;
  const publicClient = publicClientFor(deployment);
  const walletClient = walletClientFor(provider, account);
  const route = DEPOSIT_CONTRACT_ROUTE_IDS[params.route];

  onStep?.("preflight");
  // The pinned V2 target and the live wallet chain, before the approval —
  // which is itself a real transaction granting a real allowance to
  // `deployment.bridgeAddress`. Approving the retired V1 contract, or
  // approving anything at all on the wrong network, is not recoverable by
  // refusing the deposit that would have followed it.
  assertRobinhoodV2Target(deployment);
  await assertWalletOnRobinhoodChain(provider);
  // The SAME route the deposit below names, so the liveness that was
  // checked and the liveness that is relied on cannot be different routes'.
  await preflightRobinhoodDeposit({
    deployment,
    route: params.route,
    account,
    amountRaw,
  });

  const allowance = await publicClient.readContract({
    address: deployment.tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, deployment.bridgeAddress],
  });

  let approvalHash: Hex | null = null;
  if (allowance < amountRaw) {
    onStep?.("approving");
    try {
      approvalHash = await walletClient.writeContract({
        chain: null,
        address: deployment.tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        // Exactly this deposit, never unlimited.
        args: [deployment.bridgeAddress, amountRaw],
      });
    } catch (cause) {
      throw evmSendError(cause, "approval");
    }

    onStep?.("approval-confirming");
    const approvalReceipt = await publicClient
      .waitForTransactionReceipt({ hash: approvalHash })
      .catch((cause: unknown) => {
        throw evmConfirmationError(cause, approvalHash!, "unconfirmed");
      });
    if (approvalReceipt.status !== "success") {
      throw evmConfirmationError(null, approvalHash, "reverted");
    }
  }

  onStep?.("depositing");
  // Re-asserted after the approval, because waiting for that receipt is
  // the longest pause in this flow and the wallet's network is not this
  // app's to hold still. The deposit is the irreversible half.
  await assertWalletOnRobinhoodChain(provider);
  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      chain: null,
      address: deployment.bridgeAddress,
      abi: glcRobinhoodBridgeAbi,
      functionName: "deposit",
      args: [route, amountRaw, destination],
    });
  } catch (cause) {
    throw evmSendError(cause, "deposit");
  }

  onStep?.("deposit-confirming");
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash })
    .catch((cause: unknown) => {
      throw evmConfirmationError(cause, hash, "unconfirmed");
    });
  if (receipt.status !== "success") {
    throw evmConfirmationError(null, hash, "reverted");
  }

  return { hash, approvalHash };
}

/**
 * Robinhood Network (EVM) support.
 *
 * The counterpart of `@/lib/solana` for the second non-Goldcoin chain this
 * bridge spans.
 *
 * Every production transaction this module can build targets the PINNED
 * V2 custody contract on the pinned chain — see `./robinhood-target`,
 * which compiles both in and is the only place either value appears. A
 * deployment configured with anything else, including the retired V1
 * contract, resolves `robinhoodDeployment()` to `null`, refuses every
 * capability check with a stated reason, and can build no transaction at
 * all. There is no fallback path to V1 and no configuration that selects
 * it.
 *
 * Resolving a target is still not permission: the route is opened
 * backend-side (`GET /chains`' `available`, the rolling-24h wallet
 * eligibility, the contract's own `isRouteLive`), never by this code.
 */

export {
  validateEvmAddress,
  isEvmAddress,
  shortenEvmAddress,
  type EvmAddressProblem,
  type EvmAddressValidation,
} from "./address";

export {
  CONTRACT_ROUTE_IDS,
  DEPOSIT_CONTRACT_ROUTE_IDS,
  MAX_DESTINATION_LEN,
  erc20Abi,
  glcRobinhoodBridgeAbi,
  isDepositContractRoute,
  type DepositContractRoute,
  type DepositContractRouteId,
} from "./abi";

export {
  encodeGoldcoinDestination,
  encodeSolanaDestination,
  SOLANA_PUBKEY_BYTES,
  type DestinationProblem,
  type DestinationResult,
  type EncodedDestination,
} from "./destination";

export {
  isRobinhoodDeploymentConfigured,
  resolveRobinhoodDeployment,
  robinhoodDeployment,
  robinhoodDeploymentProblem,
  robinhoodDepositCapability,
  type RobinhoodDeployment,
  type RobinhoodDeploymentResolution,
  type RobinhoodDepositCapability,
  type RobinhoodDepositContext,
  type RobinhoodDepositReason,
} from "./config";

export {
  checkRobinhoodTarget,
  isRetiredRobinhoodV1BridgeAddress,
  isRobinhoodV2BridgeAddress,
  isSameEvmAddress,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_V1_BRIDGE_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
  wrongChainMessage,
  type RobinhoodTargetProblem,
  type RobinhoodTargetResult,
} from "./robinhood-target";

export {
  subscribeToInjectedWallets,
  type InjectedWallet,
  type InjectedWalletInfo,
} from "./provider";

export {
  assertRobinhoodV2Target,
  depositToRobinhoodReserve,
  preflightRobinhoodDeposit,
  type RobinhoodDepositResult,
  type RobinhoodDepositStep,
} from "./deposit";

export {
  useEvmWallet,
  useRobinhoodDeposit,
  useRobinhoodGlcBalance,
  evmWalletQueryKeys,
  type EvmWalletState,
} from "./hooks";

export { fetchRobinhoodGlcBalance, type EvmTokenBalance } from "./balance";

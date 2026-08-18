/**
 * The wallet module's entire public surface.
 *
 * Importing anything from `@solana/wallet-adapter-*` or `@solana/web3.js`
 * outside this directory is an ESLint error. If something is missing here, it
 * is added here — not worked around at the call site.
 */

export { SolanaProvider } from "./adapter/provider";

export {
  useWalletConnection,
  useSolBalance,
  useTokenBalance,
  isTokenBalanceAvailable,
  walletQueryKeys,
} from "./hooks";

export { isWalletConfigured, isMintConfigured } from "./connection";
export { isValidAddress } from "./balances";

export { useDepositToReserve } from "./send";
export type { DepositParams, DepositResult } from "./send";
export type { DepositCapability, DepositUnavailableReason } from "./deposit";
export { MAX_GLC_ADDRESS_LEN, isDepositProgramConfigured } from "./deposit";

export { detectPlatform, needsDeepLink, canOfferInstall } from "./platform";
export type { WalletPlatform, PlatformProbe } from "./platform";

export { buildDeepLinks } from "./deep-links";
export type { WalletDeepLink } from "./deep-links";

export { isUserRejection } from "./errors";

export type {
  WalletStatus,
  WalletDescriptor,
  WalletBalance,
  WalletConnection,
  WalletConnectionState,
  WalletActions,
  WalletFailure,
  WalletFailureCode,
} from "./types";

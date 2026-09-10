import {
  createPublicClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";
import { erc20Abi } from "./abi";
import type { RobinhoodDeployment } from "./config";

/**
 * The connected wallet's GLC balance on Robinhood Chain.
 *
 * # Read through the wallet, not through the deployment's RPC
 *
 * `balanceOf`/`decimals` are dispatched over the CONNECTED wallet's own
 * EIP-1193 provider. This is the account's own balance, and the wallet is
 * already the authority for which account is connected and which network
 * it is on — routing the read anywhere else means the browser opening a
 * direct connection to `NEXT_PUBLIC_ROBINHOOD_RPC_URL`, which is a
 * different node, a different set of CORS and rate-limit rules, and a
 * `connect-src` origin the page has no other reason to talk to. That path
 * is what produced a permanent "Balance unavailable" beside a wallet that
 * had connected perfectly well.
 *
 * The deployment's RPC is still the right endpoint for the reads that gate
 * a SIGNATURE (`preflightRobinhoodDeposit`), where the point is precisely
 * not to trust whichever node the wallet happens to be pointed at. That
 * distinction is deliberate: a balance shown next to a MAX button is the
 * user's own figure from the user's own wallet; a limit that decides
 * whether a transaction is built is not.
 *
 * # Exact, or absent
 *
 * The balance is carried as an integer STRING of base units and converted
 * with `BigInt` only. At 18 decimals a single GLC is 10^18 base units —
 * eleven orders of magnitude past what a JavaScript number represents
 * exactly — so a `Number` anywhere in this path would silently corrupt the
 * figure a user is about to press MAX on.
 *
 * # Decimals are asserted, never adopted
 *
 * `decimals()` is read from the token and checked against
 * {@link ROBINHOOD_DECIMALS}. A token reporting anything else is not the
 * asset this bridge models — the same assertion
 * `preflightRobinhoodDeposit` makes before a deposit — so the read FAILS
 * rather than scaling by whatever the contract happened to say. Adopting a
 * surprise value would render a balance that looks plausible and is wrong
 * by a factor of ten to the something.
 *
 * # Fail closed on the chain
 *
 * The wallet's chain is re-read from the provider immediately before the
 * contract calls and must equal the deployment's. The hook already refuses
 * to run while `onExpectedChain` is false, but that is React state read at
 * render time and a wallet can change networks between then and the call
 * landing. A `balanceOf` answered by the wrong network is a real number
 * for a different asset, which is worse than no number — so it is refused
 * here too, against the provider that is about to answer.
 */

export interface EvmTokenBalance {
  /** Integer string of base units. Never a float. */
  readonly raw: string;
  readonly decimals: number;
  readonly symbol: string;
}

export async function fetchRobinhoodGlcBalance(params: {
  readonly deployment: RobinhoodDeployment;
  readonly account: Address;
  /** The connected wallet's provider. Never `window.ethereum` read globally. */
  readonly provider: EIP1193Provider;
}): Promise<EvmTokenBalance> {
  const { deployment, account, provider } = params;

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as Hex;
  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== deployment.chainId) {
    throw new Error(
      `The wallet is on chain ${chainId}, but this balance is for chain ${deployment.chainId}`,
    );
  }

  const client = createPublicClient({ transport: custom(provider) });

  const [raw, decimals] = await Promise.all([
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: deployment.tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);

  if (Number(decimals) !== ROBINHOOD_DECIMALS) {
    throw new Error(
      `The configured token reports ${decimals} decimals, but this bridge requires ${ROBINHOOD_DECIMALS}`,
    );
  }

  return { raw: raw.toString(), decimals: ROBINHOOD_DECIMALS, symbol: "GLC" };
}

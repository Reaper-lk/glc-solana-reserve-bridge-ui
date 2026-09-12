import {
  createPublicClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { ROBINHOOD_DECIMALS } from "@/lib/bridge/robinhood-amount";
import { erc20Abi } from "./abi";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_GLC_TOKEN_ADDRESS } from "./robinhood-target";

/**
 * The connected wallet's GLC balance on Robinhood Chain.
 *
 * # The PINNED token, never a configured one
 *
 * The token address and the chain id come from `./robinhood-target` —
 * compiled-in constants — not from the deposit deployment this used to
 * take. Two reasons, and the first is a production bug:
 *
 * A balance is a read of the user's own asset. Making it depend on
 * `robinhoodDeployment()` meant it also depended on
 * `NEXT_PUBLIC_ROBINHOOD_TOKEN_ADDRESS` and
 * `NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS` agreeing with their pins — so a
 * deployment with a stale or absent token variable showed no balance and
 * no MAX button beside a wallet that had connected perfectly well, while
 * nothing about the balance involves the bridge contract at all.
 *
 * And the token is not configuration's to choose. Reading `balanceOf` on
 * an address an environment variable supplied would render a number for
 * whatever asset that address happens to be, labelled GLC. The pin is the
 * asset this build is about; `decimals()` below is how the chain confirms
 * it.
 *
 * # Read through the wallet, not through a configured RPC
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
 * # Nothing is subtracted
 *
 * The figure returned is the raw GLC token balance. Gas on Robinhood
 * Network is paid in the chain's NATIVE asset, not in GLC, so holding
 * back a gas allowance from this number would under-report what a user
 * can actually bridge — and MAX, which is built from it, would refuse
 * GLC they hold.
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
  readonly account: Address;
  /** The connected wallet's provider. Never `window.ethereum` read globally. */
  readonly provider: EIP1193Provider;
}): Promise<EvmTokenBalance> {
  const { account, provider } = params;

  const chainIdHex = (await provider.request({ method: "eth_chainId" })) as Hex;
  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(
      `The wallet is on chain ${chainId}, but this balance is for chain ${ROBINHOOD_CHAIN_ID}`,
    );
  }

  const client = createPublicClient({ transport: custom(provider) });
  const token = ROBINHOOD_GLC_TOKEN_ADDRESS as Address;

  const [raw, decimals] = await Promise.all([
    client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
    }),
    client.readContract({
      address: token,
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

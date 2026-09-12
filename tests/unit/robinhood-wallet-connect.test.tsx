import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Address } from "viem";
import { RobinhoodWalletConnect } from "@/features/wallet/RobinhoodWalletConnect";
import {
  robinhoodNetwork,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_GLC_TOKEN_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
  type EvmWalletState,
} from "@/lib/evm";

/**
 * The Robinhood wallet control, and the production regression it showed.
 *
 * # What went wrong
 *
 * Production displayed "Robinhood Network is not configured for this
 * deployment, so a wallet cannot be connected here" while the backend was
 * healthy and deliberately paused. Nobody could connect MetaMask.
 *
 * The control gated on `wallet.deployment` — the DEPOSIT deployment,
 * which required `NEXT_PUBLIC_ROBINHOOD_CHAIN_ID`,
 * `NEXT_PUBLIC_ROBINHOOD_BRIDGE_ADDRESS`, `NEXT_PUBLIC_ROBINHOOD_RPC_URL`
 * and `NEXT_PUBLIC_ROBINHOOD_TOKEN_ADDRESS` all to be present, and
 * returned `null` if any was absent. The chain id, the contract and the
 * token are compile-time constants, so an unset optional RPC URL or token
 * address disabled a control that involves none of them.
 *
 * # What these tests hold
 *
 * Connecting a wallet touches no contract. So it reads
 * `wallet.network` — pinned chain id, name, and an RPC URL with a
 * production default, which always resolves — and nothing about contract
 * configuration, route availability or the rolling-24h windows may
 * decide whether it is offered.
 */

const NETWORK = robinhoodNetwork();
const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as Address;

const DEPLOYMENT = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: NETWORK.chainName,
  rpcUrl: NETWORK.rpcUrl,
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS as Address,
  tokenAddress: ROBINHOOD_GLC_TOKEN_ADDRESS as Address,
};

const INJECTED = [
  // `icon` is a wallet-supplied data URI; the control renders it only as
  // an <img> src, never as markup.
  {
    uuid: "metamask",
    name: "MetaMask",
    rdns: "io.metamask",
    icon: "data:image/svg+xml,%3Csvg%2F%3E",
  },
];

function wallet(overrides: Partial<EvmWalletState> = {}): EvmWalletState {
  return {
    wallets: INJECTED,
    hasInjectedWallet: true,
    address: null,
    chainId: null,
    connecting: false,
    network: NETWORK,
    deployment: DEPLOYMENT,
    onExpectedChain: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    switchChain: vi.fn(),
    getProvider: () => null,
    ...overrides,
  };
}

/** The exact sentence production showed. It must never appear again. */
const REGRESSION_COPY = /is not configured for this deployment/i;

describe("RobinhoodWalletConnect — the regression", () => {
  it("offers a connect button when the DEPOSIT deployment does not resolve", async () => {
    // The production shape: no contract configuration usable, and a
    // wallet that must still be connectable.
    render(<RobinhoodWalletConnect wallet={wallet({ deployment: null })} />);

    expect(screen.queryByText(REGRESSION_COPY)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/a wallet cannot be connected here/i),
    ).not.toBeInTheDocument();
    const connect = screen.getByRole("button", { name: /Connect MetaMask/i });
    expect(connect).toBeEnabled();

    const user = userEvent.setup();
    await user.click(connect);
  });

  it("actually invokes the wallet, with the selected provider's id", async () => {
    // Not merely rendering a button: the click has to reach the wallet.
    const connect = vi.fn();
    render(<RobinhoodWalletConnect wallet={wallet({ connect, deployment: null })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Connect MetaMask/i }));
    expect(connect).toHaveBeenCalledWith("metamask");
  });

  it("names the pinned chain in the switch prompt without any deployment", async () => {
    // `wallet_addEthereumChain` needs a name and an RPC URL. Both come
    // from the network, so the prompt is never blank and never "Switch to
    // undefined".
    render(
      <RobinhoodWalletConnect
        wallet={wallet({ address: ACCOUNT, chainId: 1, deployment: null })}
      />,
    );

    expect(screen.getByText(/This wallet is on a different network/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: `Switch to ${NETWORK.chainName}` }),
    ).toBeEnabled();
    expect(screen.queryByText(REGRESSION_COPY)).not.toBeInTheDocument();
  });

  it("switches to the pinned chain even while the deployment is refused", async () => {
    const switchChain = vi.fn().mockResolvedValue(undefined);
    render(
      <RobinhoodWalletConnect
        wallet={wallet({ address: ACCOUNT, chainId: 1, deployment: null, switchChain })}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Switch to/ }));
    expect(switchChain).toHaveBeenCalled();
  });

  it("shows a connected wallet on the right chain, deployment or not", () => {
    render(
      <RobinhoodWalletConnect
        wallet={wallet({
          address: ACCOUNT,
          chainId: ROBINHOOD_CHAIN_ID,
          onExpectedChain: true,
          deployment: null,
        })}
      />,
    );

    expect(screen.getByText(/Forget/i)).toBeVisible();
    expect(
      screen.queryByText(/This wallet is on a different network/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(REGRESSION_COPY)).not.toBeInTheDocument();
  });

  it("still says so when no wallet is INSTALLED — the one real refusal left", () => {
    // The distinction the regression destroyed: "you have no wallet" is
    // the user's to act on; "this deployment is unconfigured" was not,
    // and was not even true.
    render(
      <RobinhoodWalletConnect
        wallet={wallet({ hasInjectedWallet: false, wallets: [] })}
      />,
    );

    expect(screen.getByText(/No browser wallet was detected/i)).toBeVisible();
    expect(screen.getByText(new RegExp(NETWORK.chainName))).toBeVisible();
    expect(screen.queryByText(REGRESSION_COPY)).not.toBeInTheDocument();
  });

  it("never renders the unconfigured sentence in ANY state", () => {
    // A property over the control's whole state space rather than a
    // sample of it: no combination of connection, chain and deployment
    // may produce the copy production showed.
    for (const address of [null, ACCOUNT]) {
      for (const chainId of [null, 1, ROBINHOOD_CHAIN_ID]) {
        for (const deployment of [null, DEPLOYMENT]) {
          for (const hasInjectedWallet of [true, false]) {
            const { unmount } = render(
              <RobinhoodWalletConnect
                wallet={wallet({
                  address,
                  chainId,
                  deployment,
                  hasInjectedWallet,
                  wallets: hasInjectedWallet ? INJECTED : [],
                  onExpectedChain: chainId === ROBINHOOD_CHAIN_ID,
                })}
              />,
            );
            expect(screen.queryByText(REGRESSION_COPY)).not.toBeInTheDocument();
            unmount();
          }
        }
      }
    }
  });
});

describe("RobinhoodWalletConnect — route state is not wallet state", () => {
  it("connects a wallet regardless of whether any route is open", async () => {
    // The bridge was paused when this was reported. A paused route is a
    // fact about transfers, and a user told their wallet is unsupported
    // cannot discover that the real answer is "come back later".
    const connect = vi.fn();
    render(<RobinhoodWalletConnect wallet={wallet({ connect })} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Connect MetaMask/i }));
    expect(connect).toHaveBeenCalled();
  });

  it("takes no route, availability or eligibility input at all", () => {
    // Structural: the component's only prop is the wallet. There is
    // nothing for a route's state to enter through, which is what keeps
    // the two independent by construction rather than by review.
    expect(RobinhoodWalletConnect.length).toBe(1);
  });
});

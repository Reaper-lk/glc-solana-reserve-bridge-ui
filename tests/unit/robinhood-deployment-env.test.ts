import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as EnvModule from "@/lib/config/env";

/**
 * How ENVIRONMENT configuration interacts with the pins.
 *
 * Two properties, and they pull in opposite directions — which is the
 * whole reason this file exists:
 *
 * 1. **Silence is not a fault.** An absent variable means "use the pin".
 *    Requiring presence disabled wallet connection on production, over
 *    values that are compile-time constants.
 * 2. **Disagreement is a fault, and it fails the DEPOSIT closed.** A
 *    variable naming the retired V1 contract, an unrecognised contract,
 *    the wrong chain, or a token the contract does not hold refuses —
 *    and never overrides the pin.
 *
 * And the two are kept apart: a deposit refused for (2) must still let a
 * wallet connect, because connecting a wallet touches no contract.
 */

const envState = vi.hoisted(() => ({
  robinhoodChainId: undefined as number | undefined,
  robinhoodChainName: undefined as string | undefined,
  robinhoodRpcUrl: undefined as string | undefined,
  robinhoodBridgeAddress: undefined as string | undefined,
  robinhoodTokenAddress: undefined as string | undefined,
}));

vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    get env() {
      return { ...actual.env, ...envState };
    },
  };
});

const {
  robinhoodDeployment,
  robinhoodDeploymentProblem,
  robinhoodNetwork,
  resolveRobinhoodDeployment,
} = await import("@/lib/evm/config");
const {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_DEFAULT_RPC_URL,
  ROBINHOOD_GLC_TOKEN_ADDRESS,
  ROBINHOOD_V1_BRIDGE_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
} = await import("@/lib/evm/robinhood-target");

beforeEach(() => {
  envState.robinhoodChainId = undefined;
  envState.robinhoodChainName = undefined;
  envState.robinhoodRpcUrl = undefined;
  envState.robinhoodBridgeAddress = undefined;
  envState.robinhoodTokenAddress = undefined;
});

describe("no configuration at all — the production case", () => {
  it("resolves the deposit deployment entirely from the pins", () => {
    const deployment = robinhoodDeployment();
    expect(deployment).not.toBeNull();
    expect(deployment?.chainId).toBe(4663);
    expect(deployment?.bridgeAddress).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(deployment?.tokenAddress).toBe(ROBINHOOD_GLC_TOKEN_ADDRESS);
    expect(deployment?.rpcUrl).toBe(ROBINHOOD_DEFAULT_RPC_URL);
    expect(robinhoodDeploymentProblem()).toBeNull();
  });

  it("resolves the network, which is what a wallet connects to", () => {
    expect(robinhoodNetwork()).toEqual({
      chainId: ROBINHOOD_CHAIN_ID,
      chainName: "Robinhood Network",
      rpcUrl: ROBINHOOD_DEFAULT_RPC_URL,
    });
  });
});

describe("an agreeing override changes nothing", () => {
  it("accepts the pinned values, in any casing, and still reports the pin", () => {
    envState.robinhoodChainId = 4663;
    envState.robinhoodBridgeAddress = ROBINHOOD_V2_BRIDGE_ADDRESS.toLowerCase();
    envState.robinhoodTokenAddress = ROBINHOOD_GLC_TOKEN_ADDRESS.toUpperCase().replace(
      "0X",
      "0x",
    );

    const deployment = robinhoodDeployment();
    // The canonical spellings, not the env var's — so calldata, the
    // approved spender and every comparison see one value.
    expect(deployment?.bridgeAddress).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(deployment?.tokenAddress).toBe(ROBINHOOD_GLC_TOKEN_ADDRESS);
  });

  it("uses a configured RPC URL and chain name as given", () => {
    // Transport and presentation, not identity: an RPC decides where
    // reads go and cannot redirect funds.
    envState.robinhoodRpcUrl = "https://rpc.internal.example";
    envState.robinhoodChainName = "Robinhood (staging mirror)";
    expect(robinhoodNetwork().rpcUrl).toBe("https://rpc.internal.example");
    expect(robinhoodNetwork().chainName).toBe("Robinhood (staging mirror)");
    // And the chain id is still the pin — a name never moves the chain.
    expect(robinhoodNetwork().chainId).toBe(ROBINHOOD_CHAIN_ID);
  });
});

describe("a conflicting override fails the DEPOSIT closed", () => {
  it("refuses the retired V1 contract by name", () => {
    envState.robinhoodBridgeAddress = ROBINHOOD_V1_BRIDGE_ADDRESS;
    expect(robinhoodDeployment()).toBeNull();
    const resolution = resolveRobinhoodDeployment();
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.problem).toBe("bridge-address-retired-v1");
      expect(resolution.message).toContain(ROBINHOOD_V1_BRIDGE_ADDRESS);
    }
  });

  it("refuses an unrecognised contract", () => {
    envState.robinhoodBridgeAddress = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(robinhoodDeployment()).toBeNull();
    expect(resolveRobinhoodDeployment()).toMatchObject({
      ok: false,
      problem: "bridge-address-unexpected",
    });
  });

  it("refuses the wrong chain", () => {
    envState.robinhoodChainId = 1;
    expect(robinhoodDeployment()).toBeNull();
    expect(resolveRobinhoodDeployment()).toMatchObject({
      ok: false,
      problem: "chain-id-unexpected",
    });
  });

  it("refuses a token the contract does not hold", () => {
    envState.robinhoodTokenAddress = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
    expect(robinhoodDeployment()).toBeNull();
    expect(resolveRobinhoodDeployment()).toMatchObject({
      ok: false,
      problem: "token-address-unexpected",
    });
  });

  it("never resolves a deployment naming anything but the pinned pair", () => {
    // A property over the whole conflicting space: no configuration
    // produces a usable deployment pointing anywhere else.
    for (const bridgeAddress of [
      ROBINHOOD_V1_BRIDGE_ADDRESS,
      "0x0000000000000000000000000000000000000000",
      "0xffffffffffffffffffffffffffffffffffffffff",
    ]) {
      envState.robinhoodBridgeAddress = bridgeAddress;
      expect(robinhoodDeployment()).toBeNull();
    }
  });
});

describe("wallet connection survives a conflicting override", () => {
  it("still resolves the network when the deposit deployment is refused", () => {
    // The separation the regression collapsed. A deployment naming V1 is
    // a serious fault and no deposit may be built — but a wallet still
    // connects, because connecting one signs nothing and sends nothing.
    envState.robinhoodBridgeAddress = ROBINHOOD_V1_BRIDGE_ADDRESS;
    expect(robinhoodDeployment()).toBeNull();

    const network = robinhoodNetwork();
    expect(network.chainId).toBe(ROBINHOOD_CHAIN_ID);
    expect(network.rpcUrl).toBe(ROBINHOOD_DEFAULT_RPC_URL);
    expect(network.chainName).toBe("Robinhood Network");
  });

  it("asks the wallet for the PINNED chain even on a wrong-chain config", () => {
    // A misconfigured chain id must not send a user's wallet to the wrong
    // network via `wallet_switchEthereumChain`.
    envState.robinhoodChainId = 1;
    expect(robinhoodDeployment()).toBeNull();
    expect(robinhoodNetwork().chainId).toBe(ROBINHOOD_CHAIN_ID);
    expect(robinhoodNetwork().chainId).not.toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import {
  robinhoodDepositCapability,
  type RobinhoodDeployment,
  type RobinhoodDepositContext,
} from "@/lib/evm/config";
import {
  checkRobinhoodTarget,
  isRetiredRobinhoodV1BridgeAddress,
  isRobinhoodV2BridgeAddress,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_V1_BRIDGE_ADDRESS,
  ROBINHOOD_V2_BRIDGE_ADDRESS,
} from "@/lib/evm/robinhood-target";

/**
 * The Robinhood deposit's fail-closed gate.
 *
 * Two properties matter here. First, an unconfigured deployment refuses —
 * which is the state of EVERY environment today, because the custody
 * contract is not deployed. Second, the reasons are ordered the way a user
 * can act on them: being sent through a network-switch prompt for a route
 * that is closed anyway would be wasted effort.
 */

const DEPLOYMENT: RobinhoodDeployment = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: "Robinhood Network",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

/** Everything satisfied — the only shape that yields `available: true`. */
function ready(
  overrides: Partial<RobinhoodDepositContext> = {},
): RobinhoodDepositContext {
  return {
    deployment: DEPLOYMENT,
    injectedWalletAvailable: true,
    walletConnected: true,
    connectedChainId: DEPLOYMENT.chainId,
    routeOpen: true,
    amountIsCanonical: true,
    destinationValid: true,
    ...overrides,
  };
}

describe("robinhoodDepositCapability", () => {
  it("permits a deposit only when every condition holds", () => {
    const capability = robinhoodDepositCapability(ready());
    expect(capability.available).toBe(true);
    expect(capability.reason).toBeNull();
  });

  it("refuses an unconfigured deployment — today's state in every environment", () => {
    const capability = robinhoodDepositCapability(ready({ deployment: null }));
    expect(capability.available).toBe(false);
    expect(capability.reason).toBe("deployment-unconfigured");
  });

  it("refuses an unconfigured deployment even when everything else is ready", () => {
    // The contract address is not something the UI may infer from a
    // connected wallet or an open route.
    expect(
      robinhoodDepositCapability({
        ...ready(),
        deployment: null,
        routeOpen: true,
        walletConnected: true,
      }).reason,
    ).toBe("deployment-unconfigured");
  });

  it("refuses a closed route before asking anything of the wallet", () => {
    // Ordering matters: prompting someone to install a wallet or switch
    // networks for a route that is closed anyway wastes their time.
    const capability = robinhoodDepositCapability(
      ready({ routeOpen: false, injectedWalletAvailable: false, walletConnected: false }),
    );
    expect(capability.reason).toBe("route-not-open");
  });

  it("reports a missing browser wallet distinctly from a disconnected one", () => {
    expect(
      robinhoodDepositCapability(ready({ injectedWalletAvailable: false })).reason,
    ).toBe("no-injected-wallet");
    expect(robinhoodDepositCapability(ready({ walletConnected: false })).reason).toBe(
      "wallet-disconnected",
    );
  });

  it("refuses a wallet on the wrong chain and names the expected network", () => {
    const capability = robinhoodDepositCapability(ready({ connectedChainId: 1 }));
    expect(capability.reason).toBe("wrong-chain");
    expect(capability.message).toContain("Robinhood Network");
  });

  it("refuses when the chain is not yet known, rather than assuming it matches", () => {
    expect(robinhoodDepositCapability(ready({ connectedChainId: null })).reason).toBe(
      "wrong-chain",
    );
  });

  it("refuses an invalid destination before an over-precise amount", () => {
    // Both are the user's to fix, but an unusable destination is the more
    // fundamental of the two.
    expect(
      robinhoodDepositCapability(
        ready({ destinationValid: false, amountIsCanonical: false }),
      ).reason,
    ).toBe("destination-invalid");
  });

  it("refuses an amount the contract would reject rather than rounding it", () => {
    const capability = robinhoodDepositCapability(ready({ amountIsCanonical: false }));
    expect(capability.reason).toBe("amount-not-canonical");
    expect(capability.message).toMatch(/rather than rounding/i);
  });
});

/**
 * The pinned Robinhood target — the check that makes configuration
 * incapable of selecting anything but V2.
 *
 * The failure this closes is a deployment left pointed at the retired V1
 * custody contract: the UI would have built, signed and broadcast a
 * well-formed deposit into it, V1 would have taken the GLC, and nothing
 * downstream indexes V1 any more — so the deposit would never fold and
 * never pay out. Presence of configuration is not correctness of it.
 */
describe("checkRobinhoodTarget", () => {
  const V2 = ROBINHOOD_V2_BRIDGE_ADDRESS;

  it("accepts the pinned V2 contract on chain 4663", () => {
    const result = checkRobinhoodTarget({ bridgeAddress: V2, chainId: 4663 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bridgeAddress).toBe(V2);
      expect(result.chainId).toBe(4663);
    }
  });

  it("canonicalises the casing, so one spelling reaches the chain", () => {
    // An env var, an explorer and a wallet all legitimately spell the
    // same 20 bytes differently; the calldata and the approved spender
    // must not.
    const result = checkRobinhoodTarget({
      bridgeAddress: V2.toLowerCase(),
      chainId: 4663,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bridgeAddress).toBe(V2);
  });

  it("REFUSES the retired V1 contract by name", () => {
    const result = checkRobinhoodTarget({
      bridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS,
      chainId: 4663,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe("bridge-address-retired-v1");
      expect(result.message).toContain(ROBINHOOD_V1_BRIDGE_ADDRESS);
      expect(result.message).toMatch(/never settled/);
    }
  });

  it("refuses V1 in lowercase too — the denylist is not casing-dependent", () => {
    const result = checkRobinhoodTarget({
      bridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS.toLowerCase(),
      chainId: 4663,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("bridge-address-retired-v1");
  });

  it("refuses an arbitrary contract that is neither V1 nor V2", () => {
    const result = checkRobinhoodTarget({
      bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      chainId: 4663,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toBe("bridge-address-unexpected");
  });

  it("refuses V2 on the wrong chain", () => {
    const result = checkRobinhoodTarget({ bridgeAddress: V2, chainId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe("chain-id-unexpected");
      expect(result.message).toContain("4663");
    }
  });

  it("refuses missing configuration, naming which half is missing", () => {
    expect(
      checkRobinhoodTarget({ bridgeAddress: undefined, chainId: 4663 }),
    ).toMatchObject({ ok: false, problem: "bridge-address-missing" });
    expect(checkRobinhoodTarget({ bridgeAddress: "", chainId: 4663 })).toMatchObject({
      ok: false,
      problem: "bridge-address-missing",
    });
    expect(checkRobinhoodTarget({ bridgeAddress: V2, chainId: undefined })).toMatchObject(
      { ok: false, problem: "chain-id-missing" },
    );
  });

  it("never resolves a target for any address other than V2", () => {
    // A property, not a sample: nothing in this module can be configured
    // into returning ok for a non-V2 address.
    const candidates = [
      ROBINHOOD_V1_BRIDGE_ADDRESS,
      "0x0000000000000000000000000000000000000000",
      "0xffffffffffffffffffffffffffffffffffffffff",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    ];
    for (const bridgeAddress of candidates) {
      expect(checkRobinhoodTarget({ bridgeAddress, chainId: 4663 }).ok).toBe(false);
    }
  });

  it("identifies V1 and V2 without confusing them", () => {
    expect(isRobinhoodV2BridgeAddress(ROBINHOOD_V2_BRIDGE_ADDRESS)).toBe(true);
    expect(isRobinhoodV2BridgeAddress(ROBINHOOD_V1_BRIDGE_ADDRESS)).toBe(false);
    expect(isRetiredRobinhoodV1BridgeAddress(ROBINHOOD_V1_BRIDGE_ADDRESS)).toBe(true);
    expect(isRetiredRobinhoodV1BridgeAddress(ROBINHOOD_V2_BRIDGE_ADDRESS)).toBe(false);
    expect(isRobinhoodV2BridgeAddress(null)).toBe(false);
    expect(isRetiredRobinhoodV1BridgeAddress(undefined)).toBe(false);
  });

  it("holds V1 and V2 as different addresses — the pin means nothing otherwise", () => {
    expect(ROBINHOOD_V1_BRIDGE_ADDRESS.toLowerCase()).not.toBe(
      ROBINHOOD_V2_BRIDGE_ADDRESS.toLowerCase(),
    );
  });
});

describe("robinhoodDepositCapability — the chain id is the pin, not the config", () => {
  it("refuses a wallet on any chain other than 4663", () => {
    const capability = robinhoodDepositCapability(ready({ connectedChainId: 1 }));
    expect(capability.available).toBe(false);
    expect(capability.reason).toBe("wrong-chain");
    expect(capability.message).toContain("4663");
  });

  it("refuses a wallet whose chain is unknown", () => {
    expect(robinhoodDepositCapability(ready({ connectedChainId: null }))).toMatchObject({
      available: false,
      reason: "wrong-chain",
    });
  });

  it("surfaces the deployment's own problem rather than a generic sentence", () => {
    // An operator pointed at the retired V1 contract and one who has set
    // nothing need different instructions.
    const capability = robinhoodDepositCapability(
      ready({
        deployment: null,
        deploymentProblem: `configured with the RETIRED V1 contract (${ROBINHOOD_V1_BRIDGE_ADDRESS})`,
      }),
    );
    expect(capability.available).toBe(false);
    expect(capability.message).toContain(ROBINHOOD_V1_BRIDGE_ADDRESS);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as Viem from "viem";

/**
 * The Robinhood-sourced deposit orchestration — `RhnToGlc` and `RhnToSol`.
 *
 * viem's clients are mocked so the sequence itself is under test: what is
 * read before anything is signed, what is refused, what the approval is
 * for, and what calldata the deposit names. None of this can be exercised
 * against a real chain — the custody contract is not deployed — which is
 * precisely why the shape of the calls is pinned here.
 */

const readContract = vi.fn();
const writeContract = vi.fn();
const waitForTransactionReceipt = vi.fn();

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract, waitForTransactionReceipt }),
    createWalletClient: () => ({ writeContract }),
  };
});

const { assertRobinhoodV2Target, depositToRobinhoodReserve, preflightRobinhoodDeposit } =
  await import("@/lib/evm/deposit");
const { CONTRACT_ROUTE_IDS } = await import("@/lib/evm/abi");
const { ROBINHOOD_CHAIN_ID, ROBINHOOD_V1_BRIDGE_ADDRESS, ROBINHOOD_V2_BRIDGE_ADDRESS } =
  await import("@/lib/evm/robinhood-target");

/**
 * The PINNED production target. Not an arbitrary fixture: every path
 * below now asserts the deployment names V2 on chain 4663 before it
 * reads or signs anything, so a made-up address would be refused before
 * the gate under test was ever reached.
 */
const DEPLOYMENT = {
  chainId: ROBINHOOD_CHAIN_ID,
  chainName: "Robinhood Network",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: ROBINHOOD_V2_BRIDGE_ADDRESS,
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
} as const;

/** A wallet reporting Robinhood Network, as EIP-1193 spells it. */
function providerOnChain(chainId: number | null) {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method !== "eth_chainId") throw new Error(`unexpected method ${method}`);
      if (chainId === null) throw new Error("provider cannot answer");
      return `0x${chainId.toString(16)}`;
    }),
  } as never;
}

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as const;
/** 1 GLC at 18 decimals — an exact multiple of the contract's canonical scale. */
const ONE_GLC = 1_000_000_000_000_000_000n;
const DESTINATION =
  "0x44745454663652523662743374436f5a4266583579564370367867414e6231475762" as const;

const LIMITS = {
  inboundMin: 100_000_000_000_000_000n,
  inboundMax: 20_000n * ONE_GLC,
  inboundRollingLimit: 100_000n * ONE_GLC,
  outboundMin: 0n,
  outboundMax: 0n,
  outboundRollingLimit: 0n,
  protectedMinReserve: 0n,
};

/**
 * The user-facing sentence, which is where these refusals actually live —
 * `ApiError.message` is a fixed internal label, and `presentation.what` is
 * what a person reads. Asserting the latter keeps these tests pointed at
 * the thing that matters.
 */
async function refusalText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { presentation: { what: string } }).presentation.what;
  }
  throw new Error("expected the deposit to be refused, but it was not");
}

/** The synchronous twin of `refusalText`, for the target assertions. */
function refusalTextSync(act: () => void): string {
  try {
    act();
  } catch (error) {
    return (error as { presentation: { what: string } }).presentation.what;
  }
  throw new Error("expected the target to be refused, but it was not");
}

/** Preflight reads, in the order `Promise.all` requests them. */
function healthyReads(overrides: Partial<Record<string, unknown>> = {}) {
  const values: Record<string, unknown> = {
    token: DEPLOYMENT.tokenAddress,
    decimals: 18,
    isRouteLive: true,
    limits: LIMITS,
    balanceOf: 10n * ONE_GLC,
    allowance: 0n,
    ...overrides,
  };
  readContract.mockImplementation(
    ({ functionName }: { functionName: string }) => values[functionName],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  healthyReads();
  writeContract.mockResolvedValue("0xhash");
  waitForTransactionReceipt.mockResolvedValue({ status: "success" });
});

describe("preflightRobinhoodDeposit", () => {
  // `RhnToGlc` throughout: this file is about the gates, and the route only
  // selects WHICH `isRouteLive` is read. The cross route's own id is pinned
  // in `cross-route-submit.test.ts`.
  const params = {
    deployment: DEPLOYMENT,
    route: "RhnToGlc" as const,
    account: ACCOUNT,
    amountRaw: ONE_GLC,
  };

  it("passes when every on-chain gate is open", async () => {
    await expect(preflightRobinhoodDeposit(params)).resolves.toBeUndefined();
  });

  it("refuses when the contract holds a different token than this app is configured with", async () => {
    // An approval would otherwise be granted on a token the contract never
    // pulls: a standing allowance for nothing, and a deposit that reverts.
    healthyReads({ token: "0x0000000000000000000000000000000000000001" });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /holds a different token/i,
    );
  });

  it("refuses a token that does not report 18 decimals", async () => {
    // 18 decimals is what makes Robinhood amounts a separate unit at all,
    // so a different value means this is not the asset being modelled.
    healthyReads({ decimals: 6 });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(/6 decimals/);
  });

  it("refuses when the contract itself says the route is not live", async () => {
    // The contract's gate is independent of the service's, and it can
    // close without notice.
    healthyReads({ isRouteLive: false });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /not currently accepting deposits/i,
    );
  });

  it("refuses when the wallet's balance is short", async () => {
    healthyReads({ balanceOf: ONE_GLC - 1n });
    expect(await refusalText(preflightRobinhoodDeposit(params))).toMatch(
      /balance is lower/i,
    );
  });

  it("enforces the CONTRACT's own limits, not any figure from the public API", async () => {
    // `GET /limits` describes the Solana program's reserve; these bounds
    // come from the contract that actually enforces them.
    expect(
      await refusalText(
        preflightRobinhoodDeposit({ ...params, amountRaw: LIMITS.inboundMin - 1n }),
      ),
    ).toMatch(/below the bridge contract's minimum/i);
    // Funded well past the maximum, so the balance check (which comes
    // first, being the more actionable of the two) does not answer instead.
    healthyReads({ balanceOf: 1_000_000n * ONE_GLC });
    expect(
      await refusalText(
        preflightRobinhoodDeposit({ ...params, amountRaw: LIMITS.inboundMax + 1n }),
      ),
    ).toMatch(/above the bridge contract's maximum/i);
  });

  it("says plainly that nothing was submitted, because nothing was", async () => {
    healthyReads({ isRouteLive: false });
    await expect(preflightRobinhoodDeposit(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        funds: expect.stringContaining("No funds have left your wallet"),
      }),
    });
  });
});

describe("depositToRobinhoodReserve", () => {
  const params = {
    provider: providerOnChain(ROBINHOOD_CHAIN_ID),
    deployment: DEPLOYMENT,
    route: "RhnToGlc" as const,
    account: ACCOUNT,
    amountRaw: ONE_GLC,
    destination: DESTINATION,
  };

  it("approves exactly the deposit amount, never an unlimited allowance", async () => {
    await depositToRobinhoodReserve(params);

    const approval = writeContract.mock.calls.find(
      ([call]) => call.functionName === "approve",
    );
    expect(approval).toBeDefined();
    // A standing claim on the user's balance long after one transfer is
    // not a convenience this flow needs.
    expect(approval![0].args).toEqual([DEPLOYMENT.bridgeAddress, ONE_GLC]);
  });

  it("skips the approval entirely when the allowance already covers the amount", async () => {
    healthyReads({ allowance: ONE_GLC });
    const result = await depositToRobinhoodReserve(params);

    expect(
      writeContract.mock.calls.filter(([call]) => call.functionName === "approve"),
    ).toHaveLength(0);
    expect(result.approvalHash).toBeNull();
  });

  it("deposits on the RhnToGlc route id with the destination payload unchanged", async () => {
    await depositToRobinhoodReserve(params);

    const deposit = writeContract.mock.calls.find(
      ([call]) => call.functionName === "deposit",
    );
    expect(deposit).toBeDefined();
    expect(deposit![0].address).toBe(DEPLOYMENT.bridgeAddress);
    // 0x02 is a wire contract with deployed bytecode — naming the wrong
    // route id would authorize a payout on the wrong network.
    expect(deposit![0].args).toEqual([CONTRACT_ROUTE_IDS.RhnToGlc, ONE_GLC, DESTINATION]);
    expect(CONTRACT_ROUTE_IDS.RhnToGlc).toBe(0x02);
  });

  describe("the RhnToSol route", () => {
    /*
     * The cross route's own deposit. Same function, same gates, one
     * different byte — and that byte is the whole thing the contract cannot
     * recover afterwards: `destination` is opaque bytes it never parses, so
     * the route is what tells the service they name a Solana pubkey rather
     * than a Goldcoin address.
     *
     * The payload here is 32 raw bytes (`validate_solana_destination` reads
     * that form first, by length), not the base58 text.
     */
    const SOLANA_DESTINATION = `0x${"ab".repeat(32)}` as const;
    const rhnToSolParams = {
      ...params,
      route: "RhnToSol" as const,
      destination: SOLANA_DESTINATION,
    };

    it("deposits on route id 0x04 with the 32-byte payload unchanged", async () => {
      await depositToRobinhoodReserve(rhnToSolParams);

      const deposit = writeContract.mock.calls.find(
        ([call]) => call.functionName === "deposit",
      );
      expect(deposit).toBeDefined();
      expect(deposit![0].args).toEqual([
        CONTRACT_ROUTE_IDS.RhnToSol,
        ONE_GLC,
        SOLANA_DESTINATION,
      ]);
      expect(CONTRACT_ROUTE_IDS.RhnToSol).toBe(0x04);
      // And never the sibling's id: the two routes share a contract, a
      // token and a window, so the id is the only thing distinguishing the
      // obligation the contract stores.
      expect(deposit![0].args[0]).not.toBe(CONTRACT_ROUTE_IDS.RhnToGlc);
    });

    it("reads liveness for the route it is about to deposit on", async () => {
      // Each route is gated independently on-chain. Checking `0x02`'s
      // liveness and then depositing on `0x04` would be a preflight about a
      // different route — which the contract would then revert, after the
      // approval had already been signed and paid for.
      await depositToRobinhoodReserve(rhnToSolParams);

      const liveness = readContract.mock.calls.filter(
        ([call]) => call.functionName === "isRouteLive",
      );
      expect(liveness.length).toBeGreaterThan(0);
      for (const [call] of liveness) {
        expect(call.args).toEqual([CONTRACT_ROUTE_IDS.RhnToSol]);
      }
    });

    it("still refuses on every gate the sibling refuses on", async () => {
      // The route changes which `isRouteLive` is read and nothing else: the
      // token check, the decimals check, the balance and the contract's own
      // inbound bounds all apply identically, and a cross-route deposit must
      // not have quietly skipped any of them.
      for (const reads of [
        { isRouteLive: false },
        { token: "0x0000000000000000000000000000000000000001" },
        { decimals: 6 },
        { balanceOf: 0n },
        { limits: { ...LIMITS, inboundMax: 1n } },
      ]) {
        vi.clearAllMocks();
        healthyReads(reads);
        await expect(depositToRobinhoodReserve(rhnToSolParams)).rejects.toThrow();
        expect(writeContract).not.toHaveBeenCalled();
      }
    });
  });

  it("refuses before signing anything when preflight fails", async () => {
    healthyReads({ isRouteLive: false });
    await expect(depositToRobinhoodReserve(params)).rejects.toThrow();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("reports a reverted deposit as reverted, without claiming the funds are safe", async () => {
    healthyReads({ allowance: ONE_GLC });
    waitForTransactionReceipt.mockResolvedValue({ status: "reverted" });

    await expect(depositToRobinhoodReserve(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        what: expect.stringMatching(/reverted/i),
      }),
    });
  });

  it("points at the transaction hash when confirmation cannot be verified", async () => {
    healthyReads({ allowance: ONE_GLC });
    waitForTransactionReceipt.mockRejectedValue(new Error("timeout"));

    // Genuinely ambiguous: the transaction may have landed. Never claim
    // otherwise — point at the one artefact that can answer it.
    await expect(depositToRobinhoodReserve(params)).rejects.toMatchObject({
      presentation: expect.objectContaining({
        funds: expect.stringContaining("0xhash"),
      }),
    });
  });

  it("reports the steps in order, so a two-transaction flow can be narrated", async () => {
    const steps: string[] = [];
    await depositToRobinhoodReserve({ ...params, onStep: (step) => steps.push(step) });
    expect(steps).toEqual([
      "preflight",
      "approving",
      "approval-confirming",
      "depositing",
      "deposit-confirming",
    ]);
  });

  it("returns the deposit hash, which is what the indexer's event will correspond to", async () => {
    const result = await depositToRobinhoodReserve(params);
    expect(result.hash).toBe("0xhash");
  });
});

/**
 * The V2 pin, asserted inside the module that signs.
 *
 * These are the checks that make "production RH submissions target V2
 * only" a property of the code rather than of an environment variable.
 * `resolveRobinhoodDeployment` already refuses a wrong target at config
 * time (evm-config.test.ts covers that); this covers the second line,
 * which catches a `RobinhoodDeployment` assembled by any other path — a
 * hand-built struct, a test double, a future caller.
 */
describe("the Robinhood V2 target pin", () => {
  const base = {
    route: "RhnToGlc" as const,
    account: ACCOUNT,
    amountRaw: ONE_GLC,
  };

  it("accepts the pinned V2 contract on chain 4663", () => {
    expect(() => assertRobinhoodV2Target(DEPLOYMENT)).not.toThrow();
    expect(DEPLOYMENT.bridgeAddress).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(DEPLOYMENT.chainId).toBe(4663);
  });

  it("accepts V2 in any casing — an env var and a wallet spell it differently", () => {
    expect(() =>
      assertRobinhoodV2Target({
        ...DEPLOYMENT,
        bridgeAddress:
          ROBINHOOD_V2_BRIDGE_ADDRESS.toLowerCase() as typeof DEPLOYMENT.bridgeAddress,
      }),
    ).not.toThrow();
  });

  it("REFUSES the retired V1 contract, and names it", () => {
    const what = refusalTextSync(() =>
      assertRobinhoodV2Target({
        ...DEPLOYMENT,
        bridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS as typeof DEPLOYMENT.bridgeAddress,
      }),
    );
    expect(what).toMatch(/RETIRED V1/);
    expect(what).toContain(ROBINHOOD_V1_BRIDGE_ADDRESS);
  });

  it("refuses an arbitrary contract that is neither V1 nor V2", () => {
    const what = refusalTextSync(() =>
      assertRobinhoodV2Target({
        ...DEPLOYMENT,
        bridgeAddress:
          "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as typeof DEPLOYMENT.bridgeAddress,
      }),
    );
    expect(what).toMatch(/not the Robinhood bridge contract/);
  });

  it("refuses a deployment configured for any chain other than 4663", () => {
    const what = refusalTextSync(() =>
      assertRobinhoodV2Target({ ...DEPLOYMENT, chainId: 1 }),
    );
    expect(what).toMatch(/chain 4663/);
  });

  it("never reads the chain before refusing a V1 target", async () => {
    // The order matters: a read against V1 could succeed and report a
    // live route with sane limits for a bridge nothing settles.
    await refusalText(
      preflightRobinhoodDeposit({
        ...base,
        deployment: {
          ...DEPLOYMENT,
          bridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS as typeof DEPLOYMENT.bridgeAddress,
        },
      }),
    );
    expect(readContract).not.toHaveBeenCalled();
  });

  it("refuses a V1 deposit before any transaction is signed", async () => {
    const what = await refusalText(
      depositToRobinhoodReserve({
        ...base,
        provider: providerOnChain(ROBINHOOD_CHAIN_ID),
        deployment: {
          ...DEPLOYMENT,
          bridgeAddress: ROBINHOOD_V1_BRIDGE_ADDRESS as typeof DEPLOYMENT.bridgeAddress,
        },
        destination: DESTINATION,
      }),
    );
    expect(what).toMatch(/RETIRED V1/);
    // Not even the APPROVAL: granting an allowance to V1 is itself a real
    // transaction and is not undone by refusing the deposit after it.
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("refuses when the WALLET is on the wrong chain, whatever config says", async () => {
    const what = await refusalText(
      depositToRobinhoodReserve({
        ...base,
        provider: providerOnChain(1),
        deployment: DEPLOYMENT,
        destination: DESTINATION,
      }),
    );
    expect(what).toMatch(/chain id 1/);
    expect(what).toMatch(/chain id 4663/);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("refuses when the wallet cannot say which chain it is on", async () => {
    // "I could not determine the network" and "the network is correct"
    // are different answers; only one may authorize a signature.
    const what = await refusalText(
      depositToRobinhoodReserve({
        ...base,
        provider: providerOnChain(null),
        deployment: DEPLOYMENT,
        destination: DESTINATION,
      }),
    );
    expect(what).toMatch(/unknown network/);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("re-asserts the wallet's chain after the approval, before the deposit", async () => {
    // The approval receipt is the longest pause in the flow, and the
    // wallet's network is not this app's to hold still across it.
    const provider = providerOnChain(ROBINHOOD_CHAIN_ID);
    await depositToRobinhoodReserve({
      ...base,
      provider,
      deployment: DEPLOYMENT,
      destination: DESTINATION,
    });
    const chainReads = (
      provider as unknown as { request: { mock: { calls: unknown[] } } }
    ).request.mock.calls.length;
    expect(chainReads).toBeGreaterThanOrEqual(2);
  });

  it("sends RH -> GLC to V2, on route id 0x02", async () => {
    await depositToRobinhoodReserve({
      ...base,
      route: "RhnToGlc",
      provider: providerOnChain(ROBINHOOD_CHAIN_ID),
      deployment: DEPLOYMENT,
      destination: DESTINATION,
    });
    const deposit = writeContract.mock.calls.find(
      ([call]) => call.functionName === "deposit",
    );
    expect(deposit![0].address).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(deposit![0].args[0]).toBe(CONTRACT_ROUTE_IDS.RhnToGlc);
  });

  it("sends RH -> SOL to V2, on route id 0x04", async () => {
    await depositToRobinhoodReserve({
      ...base,
      route: "RhnToSol",
      provider: providerOnChain(ROBINHOOD_CHAIN_ID),
      deployment: DEPLOYMENT,
      destination: `0x${"ab".repeat(32)}`,
    });
    const deposit = writeContract.mock.calls.find(
      ([call]) => call.functionName === "deposit",
    );
    expect(deposit![0].address).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(deposit![0].args[0]).toBe(CONTRACT_ROUTE_IDS.RhnToSol);
  });

  it("approves V2 as the spender, never V1", async () => {
    await depositToRobinhoodReserve({
      ...base,
      provider: providerOnChain(ROBINHOOD_CHAIN_ID),
      deployment: DEPLOYMENT,
      destination: DESTINATION,
    });
    const approval = writeContract.mock.calls.find(
      ([call]) => call.functionName === "approve",
    );
    expect(approval![0].args[0]).toBe(ROBINHOOD_V2_BRIDGE_ADDRESS);
    expect(approval![0].args[0]).not.toBe(ROBINHOOD_V1_BRIDGE_ADDRESS);
  });
});

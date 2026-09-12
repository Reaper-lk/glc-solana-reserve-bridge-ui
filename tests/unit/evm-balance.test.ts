import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as Viem from "viem";
import type { EIP1193Provider } from "viem";

/**
 * The Robinhood Chain balance read.
 *
 * Four properties are load-bearing:
 *
 * - the read is dispatched over the CONNECTED WALLET's EIP-1193 provider,
 *   never over `NEXT_PUBLIC_ROBINHOOD_RPC_URL`. Reading the user's own
 *   balance from a public endpoint the page has no other reason to talk to
 *   is what left a perfectly connected wallet showing "Balance unavailable";
 * - the figure survives as an exact string (an 18-decimal balance is far
 *   outside what a double holds exactly);
 * - the token's decimals are ASSERTED rather than adopted — a token
 *   reporting something other than 18 is not the asset this bridge models,
 *   and scaling by whatever it said would render a balance that looks
 *   plausible and is wrong by orders of magnitude;
 * - the chain is re-checked against the provider that is about to answer,
 *   so a wallet that moved networks cannot return a real number for the
 *   wrong asset.
 */

const readContract = vi.fn();
const custom = vi.fn(() => "custom-transport");
const http = vi.fn(() => "http-transport");

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>();
  return {
    ...actual,
    createPublicClient: () => ({ readContract }),
    custom: (...args: unknown[]) => custom(...(args as [])),
    http: (...args: unknown[]) => http(...(args as [])),
  };
});

const { fetchRobinhoodGlcBalance } = await import("@/lib/evm/balance");
const { ROBINHOOD_GLC_TOKEN_ADDRESS } = await import("@/lib/evm/robinhood-target");

const ACCOUNT = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148" as const;

/** 4663 as EIP-155 hex, which is what `eth_chainId` answers with. */
const CHAIN_4663 = "0x1237";

function providerOn(chainIdHex: string): EIP1193Provider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return chainIdHex;
      throw new Error(`unexpected ${method}`);
    }),
    on: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as EIP1193Provider;
}

function reads(values: { balanceOf?: bigint; decimals?: number }) {
  readContract.mockImplementation(({ functionName }: { functionName: string }) =>
    functionName === "balanceOf" ? (values.balanceOf ?? 0n) : (values.decimals ?? 18),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  reads({});
});

describe("fetchRobinhoodGlcBalance", () => {
  it("reads balanceOf for the connected account", async () => {
    reads({ balanceOf: 1_000_000_000_000_000_000n });
    const balance = await fetchRobinhoodGlcBalance({
      account: ACCOUNT,
      provider: providerOn(CHAIN_4663),
    });

    expect(balance).toEqual({ raw: "1000000000000000000", decimals: 18, symbol: "GLC" });
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ROBINHOOD_GLC_TOKEN_ADDRESS,
        functionName: "balanceOf",
        args: [ACCOUNT],
      }),
    );
  });

  it("dispatches both reads over the wallet's provider, not the deployment RPC", async () => {
    // The defect this file exists to prevent: a browser-side connection to
    // NEXT_PUBLIC_ROBINHOOD_RPC_URL for a figure the wallet already holds.
    const provider = providerOn(CHAIN_4663);
    reads({ balanceOf: 5n });

    await fetchRobinhoodGlcBalance({
      account: ACCOUNT,
      provider,
    });

    expect(custom).toHaveBeenCalledWith(provider);
    expect(http).not.toHaveBeenCalled();
    expect(readContract).toHaveBeenCalledTimes(2);
    const called = readContract.mock.calls.map(
      (call) => (call[0] as { functionName: string }).functionName,
    );
    expect(called).toEqual(expect.arrayContaining(["balanceOf", "decimals"]));
  });

  it("keeps every digit of a balance past Number.MAX_SAFE_INTEGER", async () => {
    // 12,450.32 GLC at 18 decimals. A `Number` anywhere in this path would
    // corrupt the very figure MAX is computed from.
    const exact = 12_450_320_000_000_000_000_000n;
    reads({ balanceOf: exact });

    const balance = await fetchRobinhoodGlcBalance({
      account: ACCOUNT,
      provider: providerOn(CHAIN_4663),
    });
    expect(balance.raw).toBe("12450320000000000000000");
    expect(BigInt(balance.raw)).toBe(exact);
    expect(Number(balance.raw) > Number.MAX_SAFE_INTEGER).toBe(true);
  });

  it("reports a zero balance as a real zero", async () => {
    // Distinct from a failed read, which the caller renders as unavailable.
    reads({ balanceOf: 0n });
    await expect(
      fetchRobinhoodGlcBalance({
        account: ACCOUNT,
        provider: providerOn(CHAIN_4663),
      }),
    ).resolves.toMatchObject({ raw: "0" });
  });

  it("refuses a token that does not report 18 decimals", async () => {
    reads({ balanceOf: 1n, decimals: 6 });
    await expect(
      fetchRobinhoodGlcBalance({
        account: ACCOUNT,
        provider: providerOn(CHAIN_4663),
      }),
    ).rejects.toThrow(/6 decimals.*requires 18/);
  });

  it("refuses to read while the wallet is on another chain", async () => {
    // Fail closed: `balanceOf` answered by the wrong network is a real
    // number for a different asset, which is worse than no number.
    await expect(
      fetchRobinhoodGlcBalance({
        account: ACCOUNT,
        provider: providerOn("0x1"),
      }),
    ).rejects.toThrow(/chain 1.*chain 4663/);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("surfaces a provider failure rather than inventing a figure", async () => {
    const provider = {
      request: vi.fn(async () => {
        throw new Error("wallet is locked");
      }),
    } as unknown as EIP1193Provider;

    await expect(
      fetchRobinhoodGlcBalance({ account: ACCOUNT, provider }),
    ).rejects.toThrow(/wallet is locked/);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("surfaces a failed contract read rather than inventing a figure", async () => {
    readContract.mockRejectedValue(new Error("eth_call reverted"));
    await expect(
      fetchRobinhoodGlcBalance({
        account: ACCOUNT,
        provider: providerOn(CHAIN_4663),
      }),
    ).rejects.toThrow(/eth_call reverted/);
  });
});

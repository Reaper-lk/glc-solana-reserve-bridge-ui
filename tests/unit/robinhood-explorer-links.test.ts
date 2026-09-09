import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which explorer a Robinhood transaction hash is linked to.
 *
 * `chainTxUrl` resolves by the CHAIN a transaction happened on, not by the
 * direction of the transfer, and that distinction is the whole point on a
 * Robinhood route: a `GlcToRhn` transfer has a Goldcoin txid on its source
 * side and an EVM hash on its destination side. Any check shaped like "is
 * this GlcToSol" would have linked one of the two to the wrong explorer —
 * a link that resolves, looks right, and shows the wrong chain.
 *
 * The templates are read once at module load, so each case stubs the
 * environment and re-imports rather than mutating a loaded config.
 */

const GOLDCOIN_TEMPLATE = "https://explorer.goldcoin.test/tx/{value}";
const SOLANA_TEMPLATE = "https://explorer.solana.test/tx/{value}";
const ROBINHOOD_TEMPLATE = "https://explorer.robinhood.test/tx/{value}";
const ROBINHOOD_ADDRESS_TEMPLATE = "https://explorer.robinhood.test/address/{value}";

const EVM_HASH = `0x${"e".repeat(64)}`;
const GOLDCOIN_TXID = "f".repeat(64);

async function links(configured: boolean) {
  vi.resetModules();
  if (configured) {
    vi.stubEnv("NEXT_PUBLIC_GLC_EXPLORER_TX_URL", GOLDCOIN_TEMPLATE);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL", SOLANA_TEMPLATE);
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_TX_URL", ROBINHOOD_TEMPLATE);
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_EXPLORER_ADDRESS_URL", ROBINHOOD_ADDRESS_TEMPLATE);
  }
  return import("@/lib/config/links");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("chainTxUrl on Robinhood routes", () => {
  it("sends a Robinhood hash to the Robinhood explorer", async () => {
    const { chainTxUrl, robinhoodTxUrl } = await links(true);
    expect(chainTxUrl("robinhood", EVM_HASH)).toBe(
      `https://explorer.robinhood.test/tx/${encodeURIComponent(EVM_HASH)}`,
    );
    // The chain-keyed resolver and the named helper are the same builder.
    expect(chainTxUrl("robinhood", EVM_HASH)).toBe(robinhoodTxUrl(EVM_HASH));
  });

  it("keeps the two sides of one GlcToRhn transfer on different explorers", async () => {
    const { chainTxUrl } = await links(true);
    // Source leg: a Goldcoin txid. Destination leg: an EVM hash. Same
    // transfer, two chains, two explorers.
    expect(chainTxUrl("goldcoin", GOLDCOIN_TXID)).toContain("explorer.goldcoin.test");
    expect(chainTxUrl("robinhood", EVM_HASH)).toContain("explorer.robinhood.test");
  });

  it("never routes a Robinhood hash through the Solana explorer", async () => {
    const { chainTxUrl } = await links(true);
    expect(chainTxUrl("robinhood", EVM_HASH)).not.toContain("solana");
  });

  it("builds a Robinhood address link from its own template", async () => {
    const { robinhoodAddressUrl } = await links(true);
    expect(robinhoodAddressUrl("0xabc")).toBe(
      "https://explorer.robinhood.test/address/0xabc",
    );
  });

  it("returns null for a network this build has no template for", async () => {
    const { chainTxUrl } = await links(true);
    // Plain text is honest; a link to a guessed host is not.
    expect(chainTxUrl("some-future-chain", EVM_HASH)).toBeNull();
  });

  it("returns null rather than a broken link when Robinhood is unconfigured", async () => {
    const { chainTxUrl, robinhoodTxUrl } = await links(false);
    expect(robinhoodTxUrl(EVM_HASH)).toBeNull();
    expect(chainTxUrl("robinhood", EVM_HASH)).toBeNull();
  });
});

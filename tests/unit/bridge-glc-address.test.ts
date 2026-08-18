import { describe, expect, it } from "vitest";
import {
  encodeBase58Check,
  isReportableAddressProblem,
  validateGoldcoinAddress,
} from "@/lib/bridge/glc-address";

/**
 * Money-critical (acceptance criterion 15).
 *
 * A wGLC burn is irreversible and the GLC it releases goes wherever this
 * address says. This function is the gate on the sign button, so the cases
 * below are deliberately hostile: near-misses that keep the shape of a valid
 * address, addresses from the wrong network, and the confusable characters
 * that transcription errors actually produce.
 *
 * Addresses are BUILT here from known version bytes rather than pasted in as
 * samples. A hardcoded sample proves only that it matches itself; a generated
 * one proves the algorithm.
 */

/** Stand-in version bytes. The real ones come from deployment configuration. */
const P2PKH = 32;
const P2SH = 5;
const RULES = { versions: [P2PKH, P2SH] };

const PAYLOAD = Uint8Array.from({ length: 20 }, (_, index) => index * 11);

const VALID_P2PKH = encodeBase58Check(P2PKH, PAYLOAD);
const VALID_P2SH = encodeBase58Check(P2SH, PAYLOAD);

describe("validateGoldcoinAddress — accepts", () => {
  it("an address on a configured version byte", () => {
    const result = validateGoldcoinAddress(VALID_P2PKH, RULES);
    expect(result.valid).toBe(true);
    expect(result.problem).toBeNull();
    expect(result.version).toBe(P2PKH);
  });

  it("a second configured version, so P2SH payouts are not refused", () => {
    expect(validateGoldcoinAddress(VALID_P2SH, RULES).version).toBe(P2SH);
  });

  it("ignores whitespace around a pasted address", () => {
    expect(validateGoldcoinAddress(`  ${VALID_P2PKH}\n`, RULES).valid).toBe(true);
  });

  it("handles a payload of leading zero bytes, which encode as leading ones", () => {
    // The arithmetic decode cannot represent leading zeros; they come from the
    // '1' prefix. Dropping them would silently change the payout destination.
    const zeros = encodeBase58Check(0, new Uint8Array(20));
    expect(zeros.startsWith("1")).toBe(true);
    expect(validateGoldcoinAddress(zeros, { versions: [0] }).valid).toBe(true);
  });
});

describe("validateGoldcoinAddress — near misses", () => {
  it("rejects a single mutated character", () => {
    // The most common real failure: one character wrong, everything else right.
    const original = VALID_P2PKH[10] as string;
    const replacement = original === "a" ? "b" : "a";
    const mutated = `${VALID_P2PKH.slice(0, 10)}${replacement}${VALID_P2PKH.slice(11)}`;

    const result = validateGoldcoinAddress(mutated, RULES);
    expect(result.valid).toBe(false);
    expect(result.problem).toBe("bad-checksum");
    expect(result.message).toMatch(/do not send to it/i);
  });

  it("rejects every single-character mutation across the whole address", () => {
    // Exhaustive rather than illustrative: a checksum that catches one position
    // and misses another is worse than no checksum, because it looks like it
    // works.
    for (let index = 0; index < VALID_P2PKH.length; index += 1) {
      const current = VALID_P2PKH[index] as string;
      const replacement = current === "z" ? "y" : "z";
      const mutated = `${VALID_P2PKH.slice(0, index)}${replacement}${VALID_P2PKH.slice(index + 1)}`;
      if (mutated === VALID_P2PKH) continue;

      expect(validateGoldcoinAddress(mutated, RULES).valid).toBe(false);
    }
  });

  it("rejects two adjacent characters transposed", () => {
    const swapped =
      VALID_P2PKH.slice(0, 8) + VALID_P2PKH[9] + VALID_P2PKH[8] + VALID_P2PKH.slice(10);
    expect(validateGoldcoinAddress(swapped, RULES).valid).toBe(false);
  });

  it("rejects a truncated paste and says so", () => {
    const result = validateGoldcoinAddress(VALID_P2PKH.slice(0, -3), RULES);
    expect(result.problem).toBe("wrong-length");
    expect(result.message).toMatch(/cut short/i);
  });

  it("rejects an address with characters appended", () => {
    expect(validateGoldcoinAddress(`${VALID_P2PKH}abc`, RULES).valid).toBe(false);
  });
});

describe("validateGoldcoinAddress — wrong network", () => {
  it("rejects a well-formed address on an unconfigured version byte", () => {
    // Checksum-valid, so only the version byte distinguishes it. Funds sent
    // here would be irrecoverable, and the message says exactly that.
    const foreign = encodeBase58Check(111, PAYLOAD);
    const result = validateGoldcoinAddress(foreign, RULES);

    expect(result.problem).toBe("wrong-network");
    expect(result.message).toMatch(/different network/i);
  });

  it("accepts the same payload once its version is configured", () => {
    const foreign = encodeBase58Check(111, PAYLOAD);
    expect(validateGoldcoinAddress(foreign, { versions: [111] }).valid).toBe(true);
  });
});

describe("validateGoldcoinAddress — hostile and confused input", () => {
  it("rejects a Solana address pasted into the Goldcoin field", () => {
    // Base58, plausible length, entirely wrong chain. A user with both wallets
    // open will do this.
    const result = validateGoldcoinAddress(
      "7xk2FqLmR8vNc3JpTgQz5wYh1sBdE9aXnU4rKt6M9afk",
      RULES,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects an Ethereum address", () => {
    expect(
      validateGoldcoinAddress("0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7", RULES).valid,
    ).toBe(false);
  });

  it.each([
    ["zero", "0"],
    ["capital O", "O"],
    ["capital I", "I"],
    ["lowercase L", "l"],
  ])("names the confusable character when %s appears", (_label, character) => {
    const withConfusable = `${VALID_P2PKH.slice(0, 5)}${character}${VALID_P2PKH.slice(6)}`;
    const result = validateGoldcoinAddress(withConfusable, RULES);

    expect(result.problem).toBe("confusable-character");
    expect(result.message).toContain(character);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
  ])("treats %s as empty rather than as an error", (_label, input) => {
    const result = validateGoldcoinAddress(input, RULES);
    expect(result.problem).toBe("empty");
    expect(result.message).toBeNull();
  });

  it.each([
    ["a sentence", "please send my coins here"],
    ["an email address", "someone@example.com"],
    ["a URL", "https://example.com/pay"],
    ["emoji", "💰💰💰"],
    ["a Cyrillic homoglyph", "DtTTf6RR6bt3tCоZBfX5yVCp6xgANb1GWb"],
    ["an embedded null byte", `DtTTf6RR\u0000bt3tCoZBfX5yVCp6xgANb1GWb`],
  ])("rejects %s", (_label, input) => {
    expect(validateGoldcoinAddress(input, RULES).valid).toBe(false);
  });

  it("rejects an address padded with internal whitespace", () => {
    const spaced = `${VALID_P2PKH.slice(0, 10)} ${VALID_P2PKH.slice(10)}`;
    expect(validateGoldcoinAddress(spaced, RULES).valid).toBe(false);
  });
});

describe("validateGoldcoinAddress — unconfigured deployment", () => {
  it("refuses to validate rather than guessing a version byte", () => {
    // The approved behaviour: state that checking is unavailable and let the
    // caller disable the action. Never fall back to an assumption.
    const result = validateGoldcoinAddress(VALID_P2PKH, { versions: [] });

    expect(result.valid).toBe(false);
    expect(result.problem).toBe("unconfigured");
    expect(result.message).toMatch(/not configured for this deployment/i);
  });

  it("reports an empty field as empty even when unconfigured", () => {
    expect(validateGoldcoinAddress("", { versions: [] }).problem).toBe("empty");
  });
});

describe("isReportableAddressProblem", () => {
  it("stays quiet for a valid address and an untouched field", () => {
    expect(isReportableAddressProblem(null)).toBe(false);
    expect(isReportableAddressProblem("empty")).toBe(false);
  });

  it("reports everything the user needs to act on", () => {
    for (const problem of [
      "unconfigured",
      "confusable-character",
      "not-base58",
      "wrong-length",
      "bad-checksum",
      "wrong-network",
    ] as const) {
      expect(isReportableAddressProblem(problem)).toBe(true);
    }
  });
});

describe("encodeBase58Check", () => {
  it("round-trips through the validator for every byte value", () => {
    for (let version = 0; version < 256; version += 1) {
      const address = encodeBase58Check(version, PAYLOAD);
      expect(validateGoldcoinAddress(address, { versions: [version] }).version).toBe(
        version,
      );
    }
  });

  it("produces only base58 characters", () => {
    expect(VALID_P2PKH).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  });
});

import { sha256 } from "@noble/hashes/sha2";

/**
 * Goldcoin payout address validation (design spec A8, acceptance criterion 15).
 *
 * The single largest loss vector in the product. A Solana -> Goldcoin
 * deposit is irreversible, and the GLC it releases goes wherever this
 * address says — so this function is the gate, and the submit action is
 * disabled until it passes.
 *
 * What it CAN catch: a mistyped character, a truncated paste, an address for
 * the wrong network, a Solana address in the Goldcoin field.
 *
 * What it CANNOT catch, and the UI must therefore warn about separately: an
 * exchange deposit address that does not credit bridge payouts, and an address
 * the user does not actually control. Those are handled by
 * `ExchangeAddressWarning` and the confirmation gate, not here.
 *
 * Version bytes are supplied by the caller from configuration. This module
 * contains no chain-specific constant — see `env.glcAddressVersions`.
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Characters Satoshi excluded from base58 precisely because they are confusable
 * in print. Seeing one is a strong signal of a transcription error rather than
 * a random corruption, so it earns its own message.
 */
const EXCLUDED = new Set(["0", "O", "I", "l"]);

export type AddressProblem =
  | "empty"
  | "unconfigured"
  | "confusable-character"
  | "not-base58"
  | "wrong-length"
  | "bad-checksum"
  | "wrong-network";

export interface AddressValidation {
  readonly valid: boolean;
  readonly problem: AddressProblem | null;
  readonly message: string | null;
  /** The version byte, once the address has decoded and checksummed cleanly. */
  readonly version: number | null;
}

const VALID: AddressValidation = {
  valid: true,
  problem: null,
  message: null,
  version: null,
};

function reject(problem: AddressProblem, message: string): AddressValidation {
  return { valid: false, problem, message, version: null };
}

export interface AddressRules {
  /** Accepted version bytes, from configuration. Empty means unconfigured. */
  readonly versions: readonly number[];
}

export function validateGoldcoinAddress(
  input: string,
  rules: AddressRules,
): AddressValidation {
  const address = input.trim();

  if (address.length === 0) {
    return { ...VALID, valid: false, problem: "empty" };
  }

  // Refusing to validate is the honest answer when we were told nothing about
  // this chain's address format. Guessing a version byte would either reject
  // valid addresses or accept ones on the wrong network.
  if (rules.versions.length === 0) {
    return reject(
      "unconfigured",
      "Payout address checking is not configured for this deployment, so we will not accept an address we cannot verify.",
    );
  }

  for (const character of address) {
    if (EXCLUDED.has(character)) {
      return reject(
        "confusable-character",
        `Goldcoin addresses never contain "${character}". Check it against your wallet — this is usually a mistyped 0/O or I/l.`,
      );
    }
  }

  const decoded = decodeBase58(address);
  if (decoded === null) {
    return reject(
      "not-base58",
      "That is not a Goldcoin address. Check you copied the whole thing from your Goldcoin wallet.",
    );
  }

  // Version byte + 20-byte hash + 4-byte checksum.
  if (decoded.length !== 25) {
    return reject(
      "wrong-length",
      "That address is the wrong length — it may have been cut short when copied. Paste it again from your wallet.",
    );
  }

  if (!hasValidChecksum(decoded)) {
    return reject(
      "bad-checksum",
      "That address failed its checksum, which means at least one character is wrong. Do not send to it — copy it again from your wallet.",
    );
  }

  const version = decoded[0] as number;
  if (!rules.versions.includes(version)) {
    return reject(
      "wrong-network",
      "That address is valid, but it belongs to a different network. Funds sent to it would not arrive. Use a Goldcoin address.",
    );
  }

  return { valid: true, problem: null, message: null, version };
}

/** "empty" is not worth shouting about while someone is still typing. */
export function isReportableAddressProblem(problem: AddressProblem | null): boolean {
  return problem !== null && problem !== "empty";
}

/**
 * Base58 decode. Returns null for anything outside the alphabet.
 *
 * BigInt rather than a byte-wise carry loop: an address is short, and exact
 * integer arithmetic removes a whole class of off-by-one bugs from code whose
 * failure mode is a misdirected payout.
 */
function decodeBase58(value: string): Uint8Array | null {
  let accumulator = 0n;

  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit === -1) return null;
    accumulator = accumulator * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (accumulator > 0n) {
    bytes.unshift(Number(accumulator % 256n));
    accumulator /= 256n;
  }

  // Each leading '1' encodes a leading zero byte, which the arithmetic above
  // cannot represent. Dropping them would change the payload.
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }

  return Uint8Array.from(bytes);
}

/** Base58check: the last four bytes are the first four of a double SHA-256. */
function hasValidChecksum(decoded: Uint8Array): boolean {
  const payload = decoded.subarray(0, decoded.length - 4);
  const expected = decoded.subarray(decoded.length - 4);
  const actual = sha256(sha256(payload)).subarray(0, 4);

  let mismatch = 0;
  for (let index = 0; index < 4; index += 1) {
    mismatch |= (expected[index] ?? 0) ^ (actual[index] ?? 0);
  }
  return mismatch === 0;
}

/**
 * Encode a payload as base58check. Exported for tests, which need to build
 * addresses with known version bytes and known-good checksums rather than
 * hardcoding sample addresses whose provenance nobody can check.
 */
export function encodeBase58Check(version: number, payload: Uint8Array): string {
  const body = Uint8Array.from([version, ...payload]);
  const checksum = sha256(sha256(body)).subarray(0, 4);
  const full = Uint8Array.from([...body, ...checksum]);

  let accumulator = 0n;
  for (const byte of full) accumulator = accumulator * 256n + BigInt(byte);

  let encoded = "";
  while (accumulator > 0n) {
    encoded = BASE58_ALPHABET[Number(accumulator % 58n)] + encoded;
    accumulator /= 58n;
  }

  for (const byte of full) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }

  return encoded;
}

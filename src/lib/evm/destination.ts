import { bytesToHex, stringToHex, type Hex } from "viem";
import { solanaPubkeyBytes } from "@/lib/solana";
import { MAX_DESTINATION_LEN } from "./abi";

/**
 * The `destination` payload for a deposit into the custody contract: how a
 * payout address on the destination network is carried across the EVM
 * boundary.
 *
 * # Both encodings are read from the backend, not chosen here
 *
 * The custody contract does NOT define them. `deposit()` takes `bytes
 * destination` and deliberately never parses it — its own docs say a
 * Goldcoin address and a Solana address "are both just bytes, and this
 * contract cannot tell them apart without becoming the address parser it
 * deliberately refuses to be". What the bytes MEAN is fixed by `route`,
 * which IS an explicit argument, and the service is what fixes the meaning,
 * at fold time.
 *
 * There is one validator per inbound route, and this module has one encoder
 * per validator:
 *
 * | route | contract id | service validator | payload |
 * |---|---|---|---|
 * | `RhnToGlc` | `0x02` | `validate_goldcoin_destination` | UTF-8 of the Base58Check address |
 * | `RhnToSol` | `0x04` | `validate_solana_destination` | the 32 raw pubkey bytes |
 *
 * # The Goldcoin payload
 *
 * Fixed by `validate_goldcoin_destination` in
 * `service/src/robinhood/fold.rs`:
 *
 * ```rust
 * let text = std::str::from_utf8(&observation.observation.destination) ... ;
 * crate::goldcoin::address::decode_p2pkh(text, network) ... ;
 * ```
 *
 * So the payload is **the UTF-8 bytes of the Base58Check-encoded Goldcoin
 * address string** — the address exactly as a user reads and pastes it,
 * not its decoded hash160, not its version+payload, not any binary form.
 * `decode_p2pkh` also means **P2PKH specifically**: the payout builder
 * (`signing::goldcoin_vault`) decodes the recipient the same way and would
 * refuse anything else, so a P2SH address folds to `ManualReview` and a
 * refund rather than paying out.
 *
 * # Why a wrong guess here would be unrecoverable
 *
 * A deposit whose destination bytes the service cannot read as an address
 * is not rejected on-chain — the contract accepts any 1..64 bytes. It is
 * accepted, the depositor's GLC is locked in the custody contract, and the
 * service parks the observation as an undeliverable destination awaiting
 * an operator refund. That is why this module encodes exactly what the
 * service decodes and validates the address against the SAME rule before
 * building anything, on both routes.
 */

/** Why a destination cannot be encoded for a Robinhood deposit. */
export type DestinationProblem = "empty" | "not-ascii" | "too-long" | "wrong-length";

/** A Solana pubkey is exactly this many bytes, which is what fixes the encoding below. */
export const SOLANA_PUBKEY_BYTES = 32;

export interface EncodedDestination {
  /** ABI `bytes` payload, `0x`-prefixed. */
  readonly hex: Hex;
  /** Byte length, which the contract bounds to 1..=64. */
  readonly byteLength: number;
}

export type DestinationResult =
  | { readonly ok: true; readonly value: EncodedDestination }
  | {
      readonly ok: false;
      readonly problem: DestinationProblem;
      readonly message: string;
    };

/**
 * Encodes an already-validated Goldcoin P2PKH address as the contract's
 * `destination` payload.
 *
 * The caller MUST have run `validateGoldcoinAddress` first: this function
 * checks only what the byte encoding itself can check (non-empty, ASCII,
 * within the contract's length bound), never whether the address is real
 * or on the right network. Base58Check is ASCII by construction, so a
 * non-ASCII character means the input was never a Goldcoin address and is
 * refused rather than silently encoded as multi-byte UTF-8.
 */
export function encodeGoldcoinDestination(address: string): DestinationResult {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      problem: "empty",
      message: "Enter a Goldcoin destination address.",
    };
  }

  // Printable ASCII only — the range Base58Check itself lives in.
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    return {
      ok: false,
      problem: "not-ascii",
      message:
        "That destination contains characters that are not part of a Goldcoin address. Re-copy it from your wallet.",
    };
  }

  const hex = stringToHex(trimmed);
  // Two hex characters per byte, after the `0x`. ASCII-only above, so this
  // equals the character count — computed from the encoded form regardless,
  // so the bound is checked against the bytes that will actually be sent.
  const byteLength = (hex.length - 2) / 2;

  if (byteLength > MAX_DESTINATION_LEN) {
    return {
      ok: false,
      problem: "too-long",
      message: `A destination address must be at most ${MAX_DESTINATION_LEN} bytes; this one is ${byteLength}.`,
    };
  }

  return { ok: true, value: { hex, byteLength } };
}

/**
 * Encodes a Solana payout address as the contract's `destination` payload
 * for an `RhnToSol` deposit: **the 32 raw bytes of the pubkey**.
 *
 * # Why the raw bytes and not the base58 text
 *
 * The service accepts either. `validate_solana_destination`
 * (`service/src/robinhood/fold.rs`) tries the raw form FIRST, by length:
 *
 * ```rust
 * if let Ok(raw) = <[u8; 32]>::try_from(payload.as_slice()) {
 *     return Ok(raw);
 * }
 * let text = std::str::from_utf8(payload)?;
 * text.parse::<solana_sdk::pubkey::Pubkey>()
 * ```
 *
 * So a 32-byte payload is ALWAYS read as a pubkey and a longer one is
 * parsed as base58 text. The raw form is therefore the one spelling that
 * cannot be reinterpreted: it hits the first branch unconditionally,
 * whatever the address is.
 *
 * The base58 spelling is length-dependent, and the backend's own comment
 * rests on that — "a valid base58 spelling of a 32-byte key is never 32
 * bytes long". That is very nearly always true and is not worth depending
 * on: a key whose leading nine bytes are zero encodes to exactly 32 base58
 * characters (the all-zero key is literally 32 `1`s), and such a payload
 * would be read as raw bytes that are not the key the user typed. Sending
 * the raw bytes removes the question rather than betting on it.
 *
 * It is also what the backend's own production rehearsal sends —
 * `service/tests/cross_route_real_node_acceptance.rs` deposits with
 * `&sol_recipient.pubkey().to_bytes()` — so this is the exact payload the
 * end-to-end path is validated against.
 *
 * # What is validated here
 *
 * `solanaPubkeyBytes` base58-decodes and requires exactly 32 bytes, the same
 * thing `Pubkey::from_str` does service-side. Neither checks that the point
 * is on the curve, because neither may: an off-curve address is a
 * legitimate payout destination and a PDA is a real account.
 *
 * The caller MUST have validated the address for the DESTINATION CHAIN
 * already (`isValidAddress`); this re-derives the bytes rather than
 * trusting that, because it is the value that actually reaches the chain.
 *
 * The contract's 1..64-byte bound is not re-checked: 32 is statically
 * inside it, and a check that can never fire reads as a real possibility.
 * {@link SOLANA_PUBKEY_BYTES} is asserted instead, which is the bound that
 * actually matters — the service's raw branch is keyed on exactly that
 * length.
 */
export function encodeSolanaDestination(address: string): DestinationResult {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      problem: "empty",
      message: "Enter a Solana destination address.",
    };
  }

  const bytes = solanaPubkeyBytes(trimmed);
  if (bytes === null) {
    return {
      ok: false,
      problem: "not-ascii",
      message:
        "That destination is not a valid Solana address. Re-copy it from your wallet.",
    };
  }

  // Belt and braces. The decoder cannot produce any other length, and the
  // service's raw branch is keyed on exactly this number — so if it ever
  // did, the payload would fall through to the base58 parser service-side
  // and be rejected there, with the deposit already made.
  if (bytes.length !== SOLANA_PUBKEY_BYTES) {
    return {
      ok: false,
      problem: "wrong-length",
      message: `A Solana address is ${SOLANA_PUBKEY_BYTES} bytes; this one decoded to ${bytes.length}.`,
    };
  }

  return {
    ok: true,
    value: { hex: bytesToHex(bytes), byteLength: bytes.length },
  };
}

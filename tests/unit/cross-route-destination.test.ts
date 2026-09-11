import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { bytesToHex, getAddress, stringToHex } from "viem";
import { payloadSelectsRobinhood, solanaDepositDestination } from "@/lib/bridge";
import {
  CONTRACT_ROUTE_IDS,
  DEPOSIT_CONTRACT_ROUTE_IDS,
  encodeGoldcoinDestination,
  encodeSolanaDestination,
  isDepositContractRoute,
  SOLANA_PUBKEY_BYTES,
} from "@/lib/evm";

/**
 * The destination payloads the two cross routes are actually submitted with.
 *
 * # Why these are pinned byte-for-byte
 *
 * Both cross routes are started by the depositor's own on-chain transaction
 * — `POST /transfers` refuses them by name ("route SolToRhn is not created
 * through this endpoint") — so there is no backend preflight to catch a
 * wrong payload. The Solana program accepts any 1..64 bytes and the custody
 * contract accepts any 1..64 bytes; neither parses an address. The service
 * parses them afterwards, at fold time, and by then the GLC is committed.
 *
 * So a wrong payload is not an error a user sees. It is one of:
 *
 * - a transfer that SUCCEEDS onto the wrong network (`SolToRhn` sent with a
 *   Goldcoin address folds as `SolToGlc`), or
 * - a deposit parked `undeliverable destination`, refundable only by an
 *   operator.
 *
 * Every expectation below is taken from the merged backend, not inferred:
 * `destination_is_robinhood` and `parse_robinhood_destination` in
 * `service/src/solana/indexer.rs`, `validate_solana_destination` and
 * `validate_goldcoin_destination` in `service/src/robinhood/fold.rs`, and the
 * payloads the production rehearsal deposits with in
 * `service/tests/cross_route_real_node_acceptance.rs`.
 */

/** A real EVM address, in three spellings of the same 20 bytes. */
const EVM_CHECKSUMMED = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const EVM_LOWER = EVM_CHECKSUMMED.toLowerCase();
const EVM_MISCASED = `0x5Aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed`;

const SOLANA_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const GOLDCOIN_ADDRESS = "mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef";

describe("solanaDepositDestination — the payload IS the route", () => {
  it("sends a Goldcoin address verbatim on SolToGlc", () => {
    // `validate_goldcoin_destination` does `str::from_utf8` then
    // `decode_p2pkh`, so the address's own text is what has to survive.
    expect(solanaDepositDestination("SolToGlc", GOLDCOIN_ADDRESS)).toEqual({
      ok: true,
      payload: GOLDCOIN_ADDRESS,
      byteLength: GOLDCOIN_ADDRESS.length,
    });
  });

  it("sends the EIP-55 CHECKSUMMED EVM address on SolToRhn", () => {
    // What the backend's own production rehearsal deposits with:
    // `evm_recipient.to_checksum_string().as_bytes()`. 42 ASCII bytes.
    expect(solanaDepositDestination("SolToRhn", EVM_CHECKSUMMED)).toEqual({
      ok: true,
      payload: EVM_CHECKSUMMED,
      byteLength: 42,
    });
  });

  it("normalises any accepted spelling to the checksummed one", () => {
    // The same 20 bytes pasted three ways produce ONE payload, so the same
    // destination always sends the same bytes. An all-lowercase address
    // carries no checksum for the service to verify; the canonical form
    // does, and this payload cannot be re-read once the deposit has landed.
    for (const spelling of [EVM_LOWER, EVM_CHECKSUMMED, EVM_CHECKSUMMED.trim()]) {
      const result = solanaDepositDestination("SolToRhn", spelling);
      expect(result.ok && result.payload).toBe(getAddress(EVM_LOWER));
    }
  });

  it("refuses a mixed-case address whose checksum does not match", () => {
    // `EvmAddress::from_str` verifies the checksum whenever the body mixes
    // case, so a corrupted mixed-case address is refused service-side too —
    // but only after the deposit, as `undeliverable destination`.
    const result = solanaDepositDestination("SolToRhn", EVM_MISCASED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/no deposit was created/i);
  });

  it("refuses a Goldcoin address offered on SolToRhn", () => {
    // The expensive mistake: this payload does NOT fail at the backend, it
    // folds as `SolToGlc` and pays out on Goldcoin. Caught here instead.
    expect(solanaDepositDestination("SolToRhn", GOLDCOIN_ADDRESS).ok).toBe(false);
  });

  it("refuses the zero address on SolToRhn", () => {
    // `parse_robinhood_destination` refuses it explicitly: the EVM burn
    // sink is not a payout destination, and a deposit naming it would
    // reserve real capacity against value that is destroyed.
    expect(solanaDepositDestination("SolToRhn", `0x${"0".repeat(40)}`).ok).toBe(false);
  });

  it("refuses an empty destination on either route", () => {
    for (const route of ["SolToGlc", "SolToRhn"] as const) {
      expect(solanaDepositDestination(route, "   ").ok).toBe(false);
    }
  });

  it("stays inside the program's 64-byte payload bound on both routes", () => {
    // `MAX_GLC_ADDRESS_LEN`. Not enforced in this function — the capability
    // the submit gate consults and the instruction builder both check it —
    // but the payloads it produces have to fit, or neither check could pass.
    for (const [route, address] of [
      ["SolToGlc", GOLDCOIN_ADDRESS],
      ["SolToRhn", EVM_CHECKSUMMED],
    ] as const) {
      const result = solanaDepositDestination(route, address);
      expect(result.ok && result.byteLength).toBeLessThanOrEqual(64);
    }
  });
});

describe("payloadSelectsRobinhood — parity with the backend's classifier", () => {
  it("is the `0x` prefix and nothing else", () => {
    // `destination_is_robinhood(payload) = payload.starts_with(b"0x")`.
    expect(payloadSelectsRobinhood(EVM_CHECKSUMMED)).toBe(true);
    expect(payloadSelectsRobinhood(EVM_LOWER)).toBe(true);
    // Not a valid address, but still classified Robinhood-bound — which is
    // why an invalid `0x` payload parks rather than becoming a Goldcoin
    // request. The UI must agree with that, not with what it wishes.
    expect(payloadSelectsRobinhood("0xnot-an-address")).toBe(true);
  });

  it("never classifies a Goldcoin address as Robinhood-bound", () => {
    // Structural, not heuristic: `0` is not in the base58 alphabet, so no
    // Base58Check address can begin with `0x`.
    expect(payloadSelectsRobinhood(GOLDCOIN_ADDRESS)).toBe(false);
    expect(payloadSelectsRobinhood(SOLANA_ADDRESS)).toBe(false);
  });

  it("agrees with the payload each route is given", () => {
    // The assertion the submit path makes before signing: the payload about
    // to be sent selects the route the form believes it is on. These two
    // facts are produced by different functions, and this is where they are
    // required to line up.
    for (const [route, address, expected] of [
      ["SolToGlc", GOLDCOIN_ADDRESS, false],
      ["SolToRhn", EVM_CHECKSUMMED, true],
    ] as const) {
      const result = solanaDepositDestination(route, address);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(payloadSelectsRobinhood(result.payload)).toBe(expected);
    }
  });
});

describe("encodeSolanaDestination — the contract payload for RhnToSol", () => {
  it("is the 32 RAW pubkey bytes", () => {
    // `validate_solana_destination` tries `<[u8;32]>::try_from` FIRST, by
    // length, so a 32-byte payload is always read as the pubkey. It is also
    // what the production rehearsal deposits with:
    // `&sol_recipient.pubkey().to_bytes()`.
    const expected = new PublicKey(SOLANA_ADDRESS).toBytes();
    expect(expected).toHaveLength(SOLANA_PUBKEY_BYTES);
    expect(encodeSolanaDestination(SOLANA_ADDRESS)).toEqual({
      ok: true,
      value: { hex: bytesToHex(expected), byteLength: 32 },
    });
  });

  it("is NOT the base58 text", () => {
    // The other accepted spelling, deliberately not used. The raw form hits
    // the service's first branch unconditionally; the text form's
    // interpretation depends on its LENGTH, and a key with nine leading zero
    // bytes encodes to exactly 32 base58 characters — which that branch
    // would then read as raw bytes that are not the key.
    const encoded = encodeSolanaDestination(SOLANA_ADDRESS);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.hex).not.toBe(stringToHex(SOLANA_ADDRESS));
    expect(encoded.value.byteLength).toBe(32);
  });

  it("round-trips to the address the user typed", () => {
    const encoded = encodeSolanaDestination(SOLANA_ADDRESS);
    if (!encoded.ok) throw new Error("expected a payload");
    const bytes = Uint8Array.from(
      encoded.value.hex
        .slice(2)
        .match(/../g)!
        .map((byte) => parseInt(byte, 16)),
    );
    expect(new PublicKey(bytes).toBase58()).toBe(SOLANA_ADDRESS);
  });

  it("refuses anything that is not a Solana address", () => {
    for (const bad of ["", "   ", GOLDCOIN_ADDRESS, EVM_CHECKSUMMED, "not a pubkey"]) {
      expect(encodeSolanaDestination(bad).ok).toBe(false);
    }
  });

  it("is never interchangeable with the Goldcoin payload", () => {
    // Both are "the contract's `destination`", and the contract cannot tell
    // them apart — the route does. Sending one where the other belongs is
    // accepted on-chain and parked undeliverable.
    const solana = encodeSolanaDestination(SOLANA_ADDRESS);
    const goldcoin = encodeGoldcoinDestination(GOLDCOIN_ADDRESS);
    expect(solana.ok && goldcoin.ok).toBe(true);
    if (!solana.ok || !goldcoin.ok) return;
    expect(solana.value.hex).not.toBe(goldcoin.value.hex);
    // And the Goldcoin one is UTF-8 TEXT, which is the distinction.
    expect(goldcoin.value.hex).toBe(stringToHex(GOLDCOIN_ADDRESS));
  });
});

describe("the contract's route ids are a wire contract", () => {
  it("matches the deployed constants exactly", () => {
    // `GlcRobinhoodBridge.sol`: ROUTE_GLC_TO_RHN = 0x01, ROUTE_RHN_TO_GLC =
    // 0x02, ROUTE_SOL_TO_RHN = 0x03, ROUTE_RHN_TO_SOL = 0x04. Never
    // renumbered, never reordered; `0x00` is permanently invalid.
    expect(CONTRACT_ROUTE_IDS).toEqual({
      GlcToRhn: 0x01,
      RhnToGlc: 0x02,
      SolToRhn: 0x03,
      RhnToSol: 0x04,
    });
  });

  it("offers only the two INBOUND routes for a deposit", () => {
    // `_routeLegs` models these two as inbound; `deposit()` reverts with
    // `NotADepositRoute` on an outbound id. Narrowing the type to them is
    // what stops a payout route from reaching the deposit call at all.
    expect(DEPOSIT_CONTRACT_ROUTE_IDS).toEqual({ RhnToGlc: 0x02, RhnToSol: 0x04 });
    expect(isDepositContractRoute("RhnToGlc")).toBe(true);
    expect(isDepositContractRoute("RhnToSol")).toBe(true);
    for (const outbound of ["GlcToRhn", "SolToRhn", "GlcToSol", "SolToGlc", ""]) {
      expect(isDepositContractRoute(outbound)).toBe(false);
    }
  });
});

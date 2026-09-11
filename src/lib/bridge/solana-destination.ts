import { validateEvmAddress } from "@/lib/evm";

/**
 * The opaque `glc_address` payload a Solana-sourced deposit carries, and
 * which ROUTE it therefore selects.
 *
 * # The program has no route field
 *
 * `deposit_to_reserve` takes `(amount, glc_address)` and nothing else — no
 * route discriminator, and the account list (including the rolling-volume
 * window PDA, seeded for the Deposit direction) is identical whichever route
 * the depositor intends. So unlike the custody contract, which takes the
 * route as an explicit argument, the Solana program cannot be told.
 *
 * The backend classifies the route from the PAYLOAD instead. From
 * `service/src/solana/indexer.rs`:
 *
 * ```rust
 * pub fn destination_is_robinhood(payload: &[u8]) -> bool {
 *     payload.starts_with(b"0x")
 * }
 * ```
 *
 * and then, for a payload that does:
 *
 * ```rust
 * let text = std::str::from_utf8(payload)?;          // must be valid UTF-8
 * text.parse::<crate::evm::address::EvmAddress>()?;  // 0x + 40 hex, EIP-55
 * if address.is_zero() { return Err(…) }             // never a destination
 * ```
 *
 * This is structurally unambiguous rather than heuristic: `0` is not in the
 * base58 alphabet, so no Goldcoin address can ever begin with `0x`. It is
 * the same argument `TransferAddressFilter` already rests on.
 *
 * # Why it is safe to rely on the backend classifying at all
 *
 * One condition is attached to it: the classifier runs only when `SolToRhn`
 * is PRICED (`[fees].SolToRhn`), and an unpriced deployment folds every
 * Solana deposit as `SolToGlc` — which would pay a Robinhood-bound deposit
 * out on Goldcoin, to an address that is not one.
 *
 * The UI never has to test for that, because the backend makes the state
 * unreachable: enabling a cross route without a configured rate is a STARTUP
 * ERROR there, never a fallback to another route's rate. So a deployment
 * reporting the route enabled on `GET /chains` is necessarily one that
 * priced it — and the form only offers the route when `/chains` reports it
 * available, which requires enabled. Availability is therefore the whole
 * check; there is no second flag to read, and inventing a local one would be
 * this client guessing at a config it cannot see.
 *
 * # Why this module exists rather than a branch at the call site
 *
 * The payload IS the route. A wrong payload is not a validation error the
 * backend returns — the Solana program accepts any 1..64 bytes, so the
 * deposit lands, and the service then either folds it as the other route or
 * parks it as undeliverable, with the user's GLC already committed. Having
 * one function own "which text for which route" means the choice is made
 * once, beside the reasoning, rather than inferred at a submit site that is
 * also doing five other things.
 *
 * # What a wrong payload actually costs, per route
 *
 * - A Goldcoin address sent intending `SolToRhn`: folded as `SolToGlc` and
 *   paid out on Goldcoin. The transfer SUCCEEDS, to the wrong network.
 * - A `0x` payload that is not a valid EVM address: folded as `SolToRhn`
 *   and parked `undeliverable destination`, refundable on Solana — never
 *   as a Goldcoin request. Recoverable, but only by an operator.
 *
 * The first is the reason this validates the address against the SAME rule
 * the service applies before returning any payload at all.
 */

/** The Solana-sourced routes. Both use the one instruction above. */
export type SolanaSourcedRoute = "SolToGlc" | "SolToRhn";

export type SolanaDestinationResult =
  | {
      readonly ok: true;
      /** The exact text to put in `glc_address`. Sent as its own UTF-8 bytes. */
      readonly payload: string;
      /**
       * UTF-8 byte length.
       *
       * Reported, not enforced here. The program's 1..=64 bound
       * (`MAX_GLC_ADDRESS_LEN`) is checked in the two places that own it:
       * `getDepositCapability`, which the submit gate consults before the
       * button enables, and `buildDepositToReserveInstruction`, which throws
       * rather than building an over-long instruction. A third check would
       * be a third copy of one constant.
       */
      readonly byteLength: number;
    }
  | { readonly ok: false; readonly message: string };

/**
 * The payload for one Solana-sourced route, or why the address cannot
 * produce one.
 *
 * `SolToGlc` sends the Goldcoin address as the user typed it — the service
 * decodes it with `decode_p2pkh`, so its own text is what has to survive.
 *
 * `SolToRhn` sends the EIP-55 CHECKSUMMED spelling of the EVM address.
 * Three reasons, and the first is sufficient on its own:
 *
 * 1. It is what the backend's production rehearsal sends —
 *    `service/tests/cross_route_real_node_acceptance.rs` deposits with
 *    `evm_recipient.to_checksum_string().as_bytes()`.
 * 2. `EvmAddress::from_str` verifies the checksum whenever the body MIXES
 *    case. A checksummed address therefore proves on arrival that its
 *    digits were not corrupted in transit; an all-lowercase one carries no
 *    such proof, and this payload cannot be re-read or corrected once the
 *    deposit has landed.
 * 3. It is the canonical spelling, so the same destination always produces
 *    the same bytes regardless of how it was pasted.
 */
export function solanaDepositDestination(
  route: SolanaSourcedRoute,
  address: string,
): SolanaDestinationResult {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter a destination address." };
  }

  const payload = (() => {
    if (route === "SolToGlc") return trimmed;
    // Re-validated here rather than trusted from the form: this is the
    // value that reaches the chain, and the service applies exactly this
    // rule to it (40 hex digits, EIP-55 when mixed case, zero refused).
    // Returning the checksummed form is what makes the payload canonical.
    const checked = validateEvmAddress(trimmed);
    return checked.valid ? checked.checksummed : null;
  })();

  if (payload === null) {
    return {
      ok: false,
      message:
        "That is not a valid Robinhood Network address, so no deposit was created. Re-copy it from your wallet.",
    };
  }

  // The payload is ASCII on both routes — Base58Check is ASCII by
  // construction and `0x` + hex plainly is — so the byte length equals the
  // character count. Measured on the encoded bytes anyway, because the
  // program's bound is on bytes.
  return {
    ok: true,
    payload,
    byteLength: new TextEncoder().encode(payload).length,
  };
}

/**
 * Whether a payload would be classified as Robinhood-bound by the service.
 *
 * The UI's own copy of `destination_is_robinhood`, used to assert that the
 * payload about to be sent selects the route the form believes it is on.
 * That assertion is the one check standing between "the wrong route" and a
 * transfer that succeeds onto a network the user did not choose.
 */
export function payloadSelectsRobinhood(payload: string): boolean {
  return payload.startsWith("0x");
}

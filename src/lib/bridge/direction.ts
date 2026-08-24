import type { Chain, Direction } from "@/lib/api/schemas/common";

/**
 * The direction model.
 *
 * Each direction names its source and destination chain and the token that
 * moves on each side — the same existing GLC on both, never a synthetic
 * derivative. The bridge form reads from this table rather than branching on
 * the direction at every call site.
 *
 * Minimums, maximums, the fee rate, and reserve capacity are NOT here —
 * those are policy, they change without a frontend deploy, and they come
 * from `GET /limits`, `GET /reserve`, `GET /status`. Decimals ARE here as a
 * display default (Goldcoin's 8 is protocol-fixed; the Solana Token-2022
 * mint's 6 is the published canonical value) — `POST /quote` reports the
 * live decimals actually used for a given amount and is authoritative
 * whenever it disagrees.
 */

export interface ChainDescriptor {
  readonly id: Chain;
  readonly name: string;
}

export interface TokenDescriptor {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
}

export interface DirectionSide {
  readonly chain: ChainDescriptor;
  readonly token: TokenDescriptor;
}

export interface DirectionDescriptor {
  readonly id: Direction;
  readonly from: DirectionSide;
  readonly to: DirectionSide;
  readonly label: string;
  /** The reserve this direction draws its payout from (`Direction::destination_reserve()`). */
  readonly destinationReserve: "goldcoin" | "solana";
}

const GOLDCOIN: ChainDescriptor = { id: "goldcoin", name: "Goldcoin" };
const SOLANA: ChainDescriptor = { id: "solana", name: "Solana" };

/**
 * Token display names, used everywhere a direction is described to a user.
 * "GLC L1" / "GLC on Solana" names the asset by where it already lives,
 * which is the point of a reserve-backed bridge — there is no "native" vs
 * "wrapped" pair to distinguish, just the same GLC on two networks.
 */
export const GOLDCOIN_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC L1",
  decimals: 8,
};
export const SOLANA_GLC: TokenDescriptor = {
  symbol: "GLC",
  name: "GLC on Solana",
  decimals: 6,
};

/**
 * The minimum GROSS amount a user may enter/bridge, in either direction —
 * a fixed product floor, deliberately NOT derived from `GET /limits`'
 * `min_transfer_amount`.
 *
 * `min_transfer_amount` (99 GLC-equivalent on-chain) is checked by the
 * program against the NET amount AFTER the 1% bridge fee is deducted
 * (`release_from_reserve`'s `limits.rs::enforce_transfer_amount`,
 * glc-solana-reserve-bridge) — it is a net-side protocol floor, not a
 * gross entry-side one, and displaying or enforcing it as the latter is
 * exactly the "Min 99 GLC" bug this constant replaces. 100 GLC gross is
 * the amount that nets to exactly 99 GLC after the fee, so entering
 * anything from 100 GLC up always clears that on-chain check.
 */
export const MINIMUM_GROSS_BRIDGE_AMOUNT_GLC = "100";

export const directions: Record<Direction, DirectionDescriptor> = {
  GlcToSol: {
    id: "GlcToSol",
    from: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    to: { chain: SOLANA, token: SOLANA_GLC },
    label: `${GOLDCOIN_GLC.name} → ${SOLANA_GLC.name}`,
    destinationReserve: "solana",
  },
  SolToGlc: {
    id: "SolToGlc",
    from: { chain: SOLANA, token: SOLANA_GLC },
    to: { chain: GOLDCOIN, token: GOLDCOIN_GLC },
    label: `${SOLANA_GLC.name} → ${GOLDCOIN_GLC.name}`,
    destinationReserve: "goldcoin",
  },
};

export function oppositeDirection(direction: Direction): Direction {
  return direction === "GlcToSol" ? "SolToGlc" : "GlcToSol";
}

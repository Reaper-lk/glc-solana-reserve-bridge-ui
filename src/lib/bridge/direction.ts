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

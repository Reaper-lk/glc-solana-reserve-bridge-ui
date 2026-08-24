import { sha256 } from "@noble/hashes/sha2";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { env } from "@/lib/config/env";

/**
 * Builds the Solana -> Goldcoin `deposit_to_reserve` instruction.
 *
 * There is no backend endpoint for this direction (`service/src/api.rs`
 * module doc, glc-solana-reserve-bridge) — the depositor's own wallet must
 * submit this Anchor instruction directly against the on-chain
 * `glc-reserve-bridge` program. This module builds it from first principles
 * (PDA seeds mirrored from `service/src/solana/accounts.rs`, the
 * account list and Borsh arg layout from `target/idl/glc_reserve_bridge.json`)
 * rather than depending on `@coral-xyz/anchor`, keeping this feature's
 * dependency footprint to what is already in the bundle
 * (`@solana/web3.js`, `@noble/hashes`).
 *
 * `glc_address` is stored on-chain as raw bytes (max 64,
 * `MAX_GLC_ADDRESS_LEN` in `programs/glc-reserve-bridge/src/constants.rs`)
 * and later hashed for a payout commitment — it is encoded here as the
 * address's own UTF-8 text, which is what a human-readable Goldcoin address
 * requires to survive an off-chain payout step that must parse it back.
 */

export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const SEED_BRIDGE_CONFIG = new TextEncoder().encode("bridge_config");
const SEED_RESERVE_AUTHORITY = new TextEncoder().encode("reserve_authority");
const SEED_WITHDRAWAL_OBLIGATION = new TextEncoder().encode("withdrawal_obligation");
const SEED_ROLLING_VOLUME_WINDOW = new TextEncoder().encode("rolling_volume_window");

/** `Direction::Deposit` seed byte, matching `initialize.rs`'s convention. */
const ROLLING_VOLUME_WINDOW_DEPOSIT_DIRECTION = 1;

export const MAX_GLC_ADDRESS_LEN = 64;

export type DepositUnavailableReason =
  | "rpc-unconfigured"
  | "program-unconfigured"
  | "wallet-disconnected"
  | "cannot-sign"
  | "address-too-long";

export interface DepositCapability {
  readonly available: boolean;
  readonly reason: DepositUnavailableReason | null;
  readonly message: string | null;
}

export interface DepositContext {
  readonly walletConfigured: boolean;
  readonly programConfigured: boolean;
  readonly walletConnected: boolean;
  readonly canSign: boolean;
  readonly glcAddressBytesLength: number;
}

/**
 * Whether the Solana -> Goldcoin deposit action can run at all, checked in
 * priority order and stated with a reason — never guessed at or silently
 * disabled.
 */
export function getDepositCapability(context: DepositContext): DepositCapability {
  if (!context.walletConfigured) {
    return {
      available: false,
      reason: "rpc-unconfigured",
      message: "Solana RPC is not configured for this deployment.",
    };
  }
  if (!context.programConfigured) {
    return {
      available: false,
      reason: "program-unconfigured",
      message:
        "The reserve bridge program id is not configured for this deployment, so this direction is unavailable.",
    };
  }
  if (!context.walletConnected) {
    return {
      available: false,
      reason: "wallet-disconnected",
      message: "Connect a Solana wallet to deposit.",
    };
  }
  if (!context.canSign) {
    return {
      available: false,
      reason: "cannot-sign",
      message: "The connected wallet cannot sign transactions.",
    };
  }
  if (
    context.glcAddressBytesLength === 0 ||
    context.glcAddressBytesLength > MAX_GLC_ADDRESS_LEN
  ) {
    return {
      available: false,
      reason: "address-too-long",
      message: `The Goldcoin address must be between 1 and ${MAX_GLC_ADDRESS_LEN} bytes.`,
    };
  }
  return { available: true, reason: null, message: null };
}

function anchorDiscriminator(instructionName: string): Uint8Array {
  return sha256(`global:${instructionName}`).slice(0, 8);
}

/** Exported for reuse by other modules in this directory that need to derive
 * a wallet's own Token-2022 ATA (e.g. `fund-reserve.ts`'s SOURCE account) —
 * never for deriving a fixed, already-existing destination account, which
 * must always be taken as given, not computed. */
export function findAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export interface DepositAccounts {
  readonly bridgeConfig: PublicKey;
  readonly depositVolumeWindow: PublicKey;
  readonly reserveAuthority: PublicKey;
  readonly userTokenAccount: PublicKey;
  readonly reserveTokenAccount: PublicKey;
  readonly withdrawalObligation: PublicKey;
}

/** Derives every PDA the instruction needs, given the next obligation index from `GET /status`. */
export function deriveDepositAccounts(params: {
  programId: PublicKey;
  user: PublicKey;
  reserveMint: PublicKey;
  obligationIndex: number;
}): DepositAccounts {
  const { programId, user, reserveMint, obligationIndex } = params;

  const bridgeConfig = PublicKey.findProgramAddressSync(
    [SEED_BRIDGE_CONFIG],
    programId,
  )[0];
  const reserveAuthority = PublicKey.findProgramAddressSync(
    [SEED_RESERVE_AUTHORITY],
    programId,
  )[0];
  const depositVolumeWindow = PublicKey.findProgramAddressSync(
    [SEED_ROLLING_VOLUME_WINDOW, Uint8Array.of(ROLLING_VOLUME_WINDOW_DEPOSIT_DIRECTION)],
    programId,
  )[0];

  const indexBytes = new Uint8Array(8);
  new DataView(indexBytes.buffer).setBigUint64(0, BigInt(obligationIndex), true);
  const withdrawalObligation = PublicKey.findProgramAddressSync(
    [SEED_WITHDRAWAL_OBLIGATION, indexBytes],
    programId,
  )[0];

  return {
    bridgeConfig,
    depositVolumeWindow,
    reserveAuthority,
    userTokenAccount: findAssociatedTokenAddress(user, reserveMint),
    reserveTokenAccount: findAssociatedTokenAddress(reserveAuthority, reserveMint),
    withdrawalObligation,
  };
}

/**
 * Builds the raw `deposit_to_reserve` instruction. `amountAtomic` is in the
 * Solana mint's own atomic units (6 decimals for the canonical GLC mint);
 * `goldcoinAddress` is the plain-text Goldcoin payout address.
 */
export function buildDepositToReserveInstruction(params: {
  programId: PublicKey;
  user: PublicKey;
  reserveMint: PublicKey;
  obligationIndex: number;
  amountAtomic: bigint;
  goldcoinAddress: string;
}): TransactionInstruction {
  const { programId, user, reserveMint, obligationIndex, amountAtomic, goldcoinAddress } =
    params;
  const accounts = deriveDepositAccounts({
    programId,
    user,
    reserveMint,
    obligationIndex,
  });

  const addressBytes = new TextEncoder().encode(goldcoinAddress);
  if (addressBytes.length === 0 || addressBytes.length > MAX_GLC_ADDRESS_LEN) {
    throw new Error(`glc_address must be between 1 and ${MAX_GLC_ADDRESS_LEN} bytes`);
  }

  const amountBytes = new Uint8Array(8);
  new DataView(amountBytes.buffer).setBigUint64(0, amountAtomic, true);

  const lengthBytes = new Uint8Array(4);
  new DataView(lengthBytes.buffer).setUint32(0, addressBytes.length, true);

  const data = Buffer.concat([
    Buffer.from(anchorDiscriminator("deposit_to_reserve")),
    Buffer.from(amountBytes),
    Buffer.from(lengthBytes),
    Buffer.from(addressBytes),
  ]);

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: accounts.bridgeConfig, isSigner: false, isWritable: true },
      { pubkey: accounts.depositVolumeWindow, isSigner: false, isWritable: true },
      { pubkey: reserveMint, isSigner: false, isWritable: false },
      { pubkey: accounts.userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.reserveAuthority, isSigner: false, isWritable: false },
      { pubkey: accounts.reserveTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.withdrawalObligation, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export function isDepositProgramConfigured(): boolean {
  return Boolean(env.reserveProgramId);
}

/** Recent blockhash + fee payer, factored out so callers can inject a test connection. */
export async function attachRecentBlockhash(
  connection: Connection,
  feePayer: PublicKey,
): Promise<{ blockhash: string; lastValidBlockHeight: number; feePayer: PublicKey }> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  return { blockhash, lastValidBlockHeight, feePayer };
}

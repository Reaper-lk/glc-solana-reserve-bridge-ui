import { z } from "zod";

/**
 * Public runtime configuration.
 *
 * Every value here is shipped to the browser and is therefore public by
 * definition. This module is the ONLY place `process.env` is read in
 * application source, and `scripts/check-no-secrets.mjs` fails the build if
 * anything outside NEXT_PUBLIC_* is ever read.
 *
 * No domain, RPC endpoint, explorer URL, or repository link is hardcoded
 * anywhere else in this codebase. If the UI renders a URL, it originates
 * here.
 *
 * Transfer limits, the fee rate, reserve capacity, and direction pause state
 * are deliberately NOT env vars: the bridge backend is authoritative for all
 * of those (`GET /limits`, `GET /status`, `GET /stats`), so the UI can never
 * drift from protocol truth.
 */

const urlSchema = z.url({ error: "must be an absolute URL including scheme" });

/** An explorer link template containing the {value} placeholder. */
const templateSchema = z.string().refine((value) => value.includes("{value}"), {
  error: "must contain the {value} placeholder",
});

const csvSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .pipe(z.array(z.string()).min(1, { error: "at least one domain is required" }));

/**
 * A comma-separated list of byte values, e.g. "32,5".
 *
 * Parsed strictly: a malformed entry fails startup rather than being dropped,
 * because a silently shortened version list would quietly reject a whole
 * class of valid Goldcoin addresses.
 */
const versionBytesSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => (/^\d+$/.test(entry) ? Number(entry) : Number.NaN)),
  )
  .pipe(
    z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(255, { error: "each version byte must be a whole number 0-255" }),
      )
      .min(1, { error: "at least one version byte is required" }),
  );

/** The canonical Solana GLC (Token-2022) mint. Public, protocol-level data. */
const DEFAULT_RESERVE_MINT_ADDRESS = "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump";

const envSchema = z
  .object({
    appUrl: urlSchema,
    officialDomains: csvSchema,
    appVersion: z.string().min(1).optional(),

    bridgeApiMode: z.enum(["mock", "http"]).default("mock"),
    bridgeApiUrl: urlSchema.optional(),

    solanaCluster: z
      .enum(["mainnet-beta", "testnet", "devnet", "localnet"])
      .default("devnet"),
    solanaRpcUrl: urlSchema.optional(),

    /** Canonical Solana GLC (Token-2022) mint. */
    reserveMintAddress: z.string().min(32).max(44),

    /**
     * The reserve bridge's on-chain Anchor program id, used to build the
     * Solana -> Goldcoin `deposit_to_reserve` instruction client-side (there
     * is no backend endpoint for that direction). Absent means that
     * direction disables with a stated reason rather than the UI guessing a
     * program id.
     */
    reserveProgramId: z.string().min(32).max(44).optional(),

    goldcoinRpcUrl: urlSchema.optional(),

    /**
     * Goldcoin base58check address version bytes, as decimals.
     *
     * Deliberately configuration rather than a constant. Guessing a version
     * byte either rejects valid addresses or accepts addresses on the wrong
     * network, and both cost the user their funds. When this is unset the UI
     * states that address validation is unavailable and disables the
     * dependent action — it never falls back to validating against an
     * assumption.
     */
    glcAddressVersions: versionBytesSchema.optional(),
    glcBech32Hrp: z.string().min(1).max(83).optional(),

    glcExplorerTxUrl: templateSchema.optional(),
    glcExplorerAddressUrl: templateSchema.optional(),
    solanaExplorerTxUrl: templateSchema.optional(),
    solanaExplorerAddressUrl: templateSchema.optional(),

    protocolRepoUrl: urlSchema.optional(),
    docsUrl: urlSchema.optional(),
    auditsUrl: urlSchema.optional(),
    bugBountyUrl: urlSchema.optional(),
    supportUrl: urlSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.bridgeApiMode === "http" && !value.bridgeApiUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["bridgeApiUrl"],
        message:
          "NEXT_PUBLIC_BRIDGE_API_URL is required when NEXT_PUBLIC_BRIDGE_API_MODE is 'http'",
      });
    }
  });

export type PublicEnv = z.infer<typeof envSchema>;

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function readEnv(): PublicEnv {
  const parsed = envSchema.safeParse({
    appUrl: present(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000",
    officialDomains: present(process.env.NEXT_PUBLIC_OFFICIAL_DOMAINS) ?? "localhost",
    appVersion: present(process.env.NEXT_PUBLIC_APP_VERSION),

    bridgeApiMode: present(process.env.NEXT_PUBLIC_BRIDGE_API_MODE) ?? "mock",
    bridgeApiUrl: present(process.env.NEXT_PUBLIC_BRIDGE_API_URL),

    solanaCluster: present(process.env.NEXT_PUBLIC_SOLANA_CLUSTER) ?? "devnet",
    solanaRpcUrl: present(process.env.NEXT_PUBLIC_SOLANA_RPC_URL),

    reserveMintAddress:
      present(process.env.NEXT_PUBLIC_RESERVE_MINT_ADDRESS) ??
      DEFAULT_RESERVE_MINT_ADDRESS,
    reserveProgramId: present(process.env.NEXT_PUBLIC_RESERVE_PROGRAM_ID),

    goldcoinRpcUrl: present(process.env.NEXT_PUBLIC_GOLDCOIN_RPC_URL),

    glcAddressVersions: present(process.env.NEXT_PUBLIC_GLC_ADDRESS_VERSIONS),
    glcBech32Hrp: present(process.env.NEXT_PUBLIC_GLC_BECH32_HRP),

    glcExplorerTxUrl: present(process.env.NEXT_PUBLIC_GLC_EXPLORER_TX_URL),
    glcExplorerAddressUrl: present(process.env.NEXT_PUBLIC_GLC_EXPLORER_ADDRESS_URL),
    solanaExplorerTxUrl: present(process.env.NEXT_PUBLIC_SOLANA_EXPLORER_TX_URL),
    solanaExplorerAddressUrl: present(
      process.env.NEXT_PUBLIC_SOLANA_EXPLORER_ADDRESS_URL,
    ),

    protocolRepoUrl: present(process.env.NEXT_PUBLIC_PROTOCOL_REPO_URL),
    docsUrl: present(process.env.NEXT_PUBLIC_DOCS_URL),
    auditsUrl: present(process.env.NEXT_PUBLIC_AUDITS_URL),
    bugBountyUrl: present(process.env.NEXT_PUBLIC_BUG_BOUNTY_URL),
    supportUrl: present(process.env.NEXT_PUBLIC_SUPPORT_URL),
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid public environment configuration:\n${detail}\n\nSee .env.example.`,
    );
  }

  return parsed.data;
}

export const env: PublicEnv = readEnv();

/** Protocol-fixed native Goldcoin decimals (never derived at runtime). */
export const GOLDCOIN_DECIMALS = 8;

/** Exported for tests, which exercise the parser against crafted inputs. */
export const __envSchemaForTests = envSchema;

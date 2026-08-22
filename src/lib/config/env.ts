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

/**
 * Program ids the bridge has permanently retired, mirrored from the backend's
 * own denylist (`service/src/bin/glc-mainnet-bootstrap.rs` /
 * `scripts/verify-program-id-replacement.sh` in glc-solana-reserve-bridge):
 *
 * - `BnCF…v2oY` — the original scaffold/dev id. Still what local validators
 *   deploy at during development, but never deployed to a public cluster.
 * - `7h2z…1GNn` — the first mainnet deployment, since permanently closed
 *   with its rent reclaimed. A transaction sent to it can never succeed.
 *
 * A mainnet-beta deployment configured with either is a stale config that
 *  would build deposit instructions against a dead or never-deployed
 * program, so it fails startup here rather than failing in users' wallets.
 * Non-mainnet clusters are exempt: the dev id is the legitimate localnet id.
 */
const RETIRED_RESERVE_PROGRAM_IDS = new Set([
  "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY",
  "7h2zSJuqpmbSq4seeXDdaJChVoxhEWwA9b8qG6Ct1GNn",
]);

const envSchema = z
  .object({
    appUrl: urlSchema,
    officialDomains: csvSchema,
    appVersion: z.string().min(1).optional(),

    bridgeApiMode: z.enum(["mock", "http"]).default("mock"),
    bridgeApiUrl: urlSchema.optional(),
    /**
     * Real backend origin for the local dev-only same-origin proxy
     * (`app/api/bridge/[...path]/route.ts`), read server-side only. Exists
     * because the real bridge service has no CORS headers of its own
     * (`service/src/api.rs` module doc) — pointing `bridgeApiUrl` at
     * `/api/bridge` keeps the browser's fetches same-origin during local
     * development, while this variable tells the proxy route what real
     * backend to forward them to. NOT a production mechanism: production
     * puts a real reverse proxy in front of the backend and points
     * `bridgeApiUrl` at that directly (see .env.example).
     */
    bridgeApiProxyUpstreamUrl: urlSchema.optional(),
    /**
     * Which unhappy path the mock client simulates. Exists purely so E2E
     * tests can exercise a paused direction or exhausted reserve capacity
     * against a real running server without a live backend — never read
     * outside `NEXT_PUBLIC_BRIDGE_API_MODE=mock`.
     */
    mockScenario: z
      .enum([
        "operational",
        "paused",
        "insufficient-liquidity",
        "quota-exhausted",
        "quota-paused",
      ])
      .default("operational"),

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
    if (
      value.solanaCluster === "mainnet-beta" &&
      value.reserveProgramId !== undefined &&
      RETIRED_RESERVE_PROGRAM_IDS.has(value.reserveProgramId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reserveProgramId"],
        message:
          `NEXT_PUBLIC_RESERVE_PROGRAM_ID ${value.reserveProgramId} is a ` +
          "permanently retired bridge program id and cannot be used on " +
          "mainnet-beta — see .env.example for the current production id",
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
    mockScenario: present(process.env.NEXT_PUBLIC_MOCK_SCENARIO) ?? "operational",
    bridgeApiUrl: present(process.env.NEXT_PUBLIC_BRIDGE_API_URL),
    bridgeApiProxyUpstreamUrl: present(
      process.env.NEXT_PUBLIC_BRIDGE_API_PROXY_UPSTREAM_URL,
    ),

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

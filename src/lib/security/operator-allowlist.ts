/**
 * Reserve-funding operator allowlist (`middleware.ts`'s
 * `/admin/fund-reserve/operator-check`).
 *
 * A pure function of its inputs, exactly like `csp.ts` next to it — so the
 * decision logic is asserted directly in unit tests rather than only
 * reachable through a constructed `NextRequest`. `middleware.ts` is the
 * only caller that ever reads the actual environment variable; this
 * module never touches `process.env` itself, which is what lets it live
 * under `src/lib/` without tripping `scripts/check-no-secrets.mjs`'s
 * non-public-env-read check (that check flags `process.env` reads, not
 * plain string parameters).
 */

/** Parses a comma-separated allowlist into a set of trimmed, non-empty
 * entries. Solana addresses are compared byte-for-byte as base58 text —
 * no normalization beyond trimming whitespace, since a wrong-case or
 * differently-encoded match would be a correctness bug, not a convenience. */
export function parseOperatorAllowlist(allowlistCsv: string | undefined): Set<string> {
  return new Set(
    (allowlistCsv ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

/**
 * Whether `address` is authorized to fund the reserve. Fails closed: an
 * empty or unset allowlist authorizes nobody, and an empty/missing
 * `address` is never authorized regardless of the allowlist's contents —
 * there is no "authorize everyone" state this function can produce.
 */
export function isAuthorizedOperator(
  address: string | null | undefined,
  allowlistCsv: string | undefined,
): boolean {
  const trimmed = address?.trim() ?? "";
  if (trimmed.length === 0) return false;
  return parseOperatorAllowlist(allowlistCsv).has(trimmed);
}

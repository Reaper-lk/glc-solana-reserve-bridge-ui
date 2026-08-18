#!/usr/bin/env node
/**
 * Dependency-audit gate: `npm audit` with a narrowly-scoped, documented
 * per-advisory allowlist. Replaces the bare `npm audit --audit-level=high`
 * CI step, because npm audit has no per-advisory ignore and this
 * repository's policy ("a high-severity advisory in a bridge frontend is a
 * release blocker") needs exactly two documented exceptions — nothing
 * broader. Zero new dependencies, mirroring scripts/check-no-secrets.mjs.
 *
 * Gate rule: every HIGH or CRITICAL advisory in `npm audit --json` must be
 * individually allowlisted by its exact GHSA id below, or this script
 * exits 1. Severity- or package-wide suppression is deliberately not
 * supported. Anything malformed — unparseable output, missing fields, a
 * high/critical count that yields no parseable advisories, an advisory
 * with no recognizable GHSA id — FAILS CLOSED rather than passing.
 *
 * # The two allowed advisories, and why (documented per policy)
 *
 * Both are infinite-loop denial-of-service findings in `image-size`:
 *
 *   - GHSA-w3rx-r6r6-pgpr  (ICNS parser)
 *   - GHSA-5p2g-fcmc-qvqq  (JXL/HEIF parsers)
 *
 * Exact dependency chain (transitive; nothing in this repository imports
 * image-size):
 *
 *   @solana/wallet-adapter-react@0.15.39            (direct dependency)
 *   └─ @solana-mobile/wallet-adapter-mobile@2.2.9
 *      └─ react-native@0.87.0                       (non-optional PEER, auto-installed by npm >= 7)
 *         └─ @react-native/community-cli-plugin
 *            └─ metro                               (the React Native bundler)
 *               └─ image-size                       ← the advisories
 *
 * Not runtime-reachable from this bridge web application: the sole
 * requirer of image-size in the whole tree is `metro/src/Assets.js`, the
 * React Native BUNDLER, which only executes when building a React Native
 * app. Next.js never invokes metro; metro/image-size are in neither the
 * server runtime nor the browser bundle, and this application performs no
 * server-side image parsing at all (its one image renders `unoptimized`).
 * The wallet-adapter web/Android code paths never touch metro.
 *
 * No fixed image-size release exists: the vulnerable range is <=2.0.2 and
 * 2.0.2 IS the latest published version (npm reports fixAvailable: false).
 * Upgrading the wallet chain does not eliminate it either: the
 * @solana-mobile packages declare react-native as a NON-optional peer
 * dependency at every published version (including wallet-adapter-mobile
 * 2.3.0, which drops it only from `dependencies`), so npm always installs
 * the react-native → metro → image-size subtree.
 *
 * Rejected alternatives: an override/stub alias for image-size would
 * misrepresent the dependency graph (there is no real fixed version to
 * override to) and could break anyone who ever runs metro; removing
 * @solana/wallet-adapter-react would rewrite the verified wallet boundary
 * and risk the working Phantom flow — including Android Mobile Wallet
 * Adapter support — to silence a build-tool-only advisory.
 *
 * TODO(revisit — REMOVE these allowlist entries as soon as either):
 *   a. an image-size release outside the vulnerable range (> 2.0.2)
 *      becomes available and resolves compatibly in this tree, or
 *   b. the @solana-mobile/wallet-adapter chain stops pulling the
 *      vulnerable dependency (e.g. makes the react-native peer optional
 *      or drops metro from the installed graph).
 * When either happens, `npm audit --audit-level=high` alone suffices
 * again and this script's allowlist must shrink to empty (or the script
 * be deleted in favor of the plain audit step).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOWLISTED_GHSA_IDS = new Set(["GHSA-w3rx-r6r6-pgpr", "GHSA-5p2g-fcmc-qvqq"]);

const GATED_SEVERITIES = new Set(["high", "critical"]);

function fail(message) {
  console.error(`audit gate FAILED: ${message}`);
  process.exit(1);
}

/**
 * `--input <file>` reads a saved `npm audit --json` document instead of
 * invoking npm — the deterministic hook the gate's own tests use. CI and
 * local runs pass no arguments and audit the real installed tree.
 */
function loadAuditJson() {
  const inputFlag = process.argv.indexOf("--input");
  if (inputFlag !== -1) {
    const path = process.argv[inputFlag + 1];
    if (!path) fail("--input requires a file path");
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      fail(`could not read ${path}: ${error.message}`);
    }
  }
  // npm exits non-zero when vulnerabilities exist — the JSON on stdout is
  // still the report, so only a missing/empty stdout is treated as a
  // failure to audit.
  const result = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`could not run npm audit: ${result.error.message}`);
  if (!result.stdout || result.stdout.trim().length === 0) {
    fail("npm audit produced no output");
  }
  return result.stdout;
}

function extractGhsaId(url) {
  const match = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(url ?? ""));
  return match ? match[0] : null;
}

const rawJson = loadAuditJson();

let audit;
try {
  audit = JSON.parse(rawJson);
} catch {
  fail("npm audit output was not valid JSON — refusing to pass unaudited");
}
if (typeof audit !== "object" || audit === null) {
  fail("npm audit output was not an object — refusing to pass unaudited");
}
if (audit.error) {
  fail(`npm audit reported an error: ${JSON.stringify(audit.error)}`);
}

const vulnerabilities = audit.vulnerabilities;
const counts = audit.metadata?.vulnerabilities;
if (typeof vulnerabilities !== "object" || vulnerabilities === null) {
  fail("npm audit output had no vulnerabilities object — refusing to pass unaudited");
}
if (typeof counts !== "object" || counts === null) {
  fail("npm audit output had no metadata.vulnerabilities — refusing to pass unaudited");
}

// Collect every distinct high/critical ADVISORY (the `via` entries that
// are objects; plain-string entries are transitive references to another
// package's advisory and carry no id of their own).
const blocking = [];
const accepted = [];
for (const [name, vuln] of Object.entries(vulnerabilities)) {
  for (const via of Array.isArray(vuln?.via) ? vuln.via : []) {
    if (typeof via !== "object" || via === null) continue;
    const severity = String(via.severity ?? "").toLowerCase();
    if (!GATED_SEVERITIES.has(severity)) continue;
    const ghsa = extractGhsaId(via.url);
    if (!ghsa) {
      fail(
        `${severity} advisory on "${name}" has no recognizable GHSA id ` +
          `(url: ${String(via.url)}) — refusing to pass an unidentifiable advisory`,
      );
    }
    if (ALLOWLISTED_GHSA_IDS.has(ghsa)) {
      accepted.push(`${ghsa} (${name}: ${via.title ?? "untitled"})`);
    } else {
      blocking.push(
        `${severity.toUpperCase()} ${ghsa} on "${name}": ${via.title ?? "untitled"}`,
      );
    }
  }
}

// Fail-closed cross-check: if npm counted high/critical vulnerabilities
// but the walk above surfaced no advisory objects at all, the report
// shape has drifted and this gate can no longer vouch for anything.
const countedGated = Number(counts.high ?? 0) + Number(counts.critical ?? 0);
if (countedGated > 0 && accepted.length === 0 && blocking.length === 0) {
  fail(
    `npm audit counts ${countedGated} high/critical vulnerabilities but no ` +
      "advisories could be parsed — report format drift, refusing to pass",
  );
}

if (blocking.length > 0) {
  console.error("audit gate FAILED — non-allowlisted high/critical advisories:");
  for (const line of blocking) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(
  `audit gate passed: ${countedGated} high/critical finding(s), all covered by the ` +
    `${ALLOWLISTED_GHSA_IDS.size} documented image-size allowlist entries` +
    (accepted.length > 0 ? `:\n  - ${[...new Set(accepted)].join("\n  - ")}` : "."),
);

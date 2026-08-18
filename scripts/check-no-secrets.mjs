#!/usr/bin/env node
/**
 * Secret guard — acceptance criterion 11 ("no private keys, credentials, signer
 * addresses, or operator secrets") enforced mechanically rather than by review.
 *
 * Runs in CI on every push and as the first step of `npm run verify`.
 *
 * Three checks:
 *   1. No environment variable NAME in the repo looks like a secret.
 *   2. No source file reads a non-public environment variable. Anything the
 *      browser can read must be NEXT_PUBLIC_*; anything else in this codebase
 *      would mean server-only material has entered an untrusted frontend.
 *   3. No file contains an inline private key / credential block.
 *
 * Exit code 1 on any finding.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "out",
  "coverage",
  "playwright-report",
  "test-results",
]);

/** Env-var name fragments that must never appear in a frontend. */
const FORBIDDEN_NAME_PATTERNS = [
  /SIGNER/i,
  /FEDERATION_KEY/i,
  /\bADMIN\b/i,
  /PRIVATE/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSPHRASE/i,
  /CREDENTIAL/i,
  /MNEMONIC/i,
  /SEED_PHRASE/i,
  /\bTLS\b/i,
  /API_KEY/i,
  /ACCESS_TOKEN/i,
  /AUTH_TOKEN/i,
  /KEYPAIR/i,
  /OPERATOR_(KEY|ENDPOINT|URL)/i,
];

/** Non-public env vars a frontend build may legitimately read. */
const ALLOWED_NON_PUBLIC_ENV = new Set([
  "NODE_ENV",
  "ANALYZE",
  "CI",
  "npm_package_version",
]);

const INLINE_SECRET_PATTERNS = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "inline private key block" },
  { re: /-----BEGIN CERTIFICATE-----/, label: "inline certificate" },
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const findings = [];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const allFiles = walk(ROOT);

for (const file of allFiles) {
  const rel = relative(ROOT, file);
  const isEnvFile = /(^|\/)\.env($|\.)/.test(rel);
  const isSource = SOURCE_EXTENSIONS.has(extname(file));
  const isLockfile = rel === "package-lock.json";

  if (!isEnvFile && !isSource && !rel.endsWith(".md") && !rel.endsWith(".yml")) {
    continue;
  }

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // 1. Env var names that look like secrets, wherever they are declared.
  const declaredNames = new Set();
  if (isEnvFile) {
    for (const line of content.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
      if (match?.[1]) declaredNames.add(match[1]);
    }
  }
  for (const match of content.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) {
    if (match[1]) declaredNames.add(match[1]);
  }
  for (const match of content.matchAll(/process\.env\[["']([A-Za-z0-9_]+)["']\]/g)) {
    if (match[1]) declaredNames.add(match[1]);
  }

  for (const name of declaredNames) {
    for (const pattern of FORBIDDEN_NAME_PATTERNS) {
      if (pattern.test(name)) {
        findings.push(`${rel}: environment variable "${name}" matches ${pattern}`);
      }
    }

    // 2. Non-public env access in application source.
    const inAppSource = isSource && (rel.startsWith("src/") || rel.startsWith("app/"));
    if (
      inAppSource &&
      !name.startsWith("NEXT_PUBLIC_") &&
      !ALLOWED_NON_PUBLIC_ENV.has(name)
    ) {
      findings.push(
        `${rel}: reads non-public env var "${name}" — frontend code may only read NEXT_PUBLIC_*`,
      );
    }
  }

  // 3. Inline credential material. This file is excluded because it must
  // necessarily contain the very patterns it searches for.
  const isThisScript = rel === "scripts/check-no-secrets.mjs";
  if (!isLockfile && !isThisScript) {
    for (const { re, label } of INLINE_SECRET_PATTERNS) {
      if (re.test(content)) findings.push(`${rel}: contains ${label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("\n  Secret guard FAILED — this frontend must contain no secrets.\n");
  for (const finding of findings) console.error(`   - ${finding}`);
  console.error("");
  process.exit(1);
}

console.log("Secret guard passed: no secret-shaped env names, no non-public env reads.");

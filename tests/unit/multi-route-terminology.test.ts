import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Copy that assumes a two-direction Solana bridge.
 *
 * The bridge runs four executable routes across three reserves. Any
 * user-facing sentence that says "both sides" or "both directions", or
 * that describes the bridge as paused as a whole, is describing a topology
 * this product no longer has — and it is wrong in the dangerous direction,
 * because the two Solana directions being fine says nothing about whether
 * a Robinhood route is.
 *
 * # Why the scan strips comments first
 *
 * The modules that REPLACED these sentences quote them, at length, to
 * record what was wrong with them and why the derivation changed. A raw
 * grep would flag exactly the explanations that exist to stop the mistake
 * from being made again. So comments come out and rendered copy stays in.
 *
 * Only block comments and whole comment lines are stripped, never an
 * inline `//` — that would also swallow the tail of any line containing a
 * URL, which is how a scan like this quietly stops scanning.
 */

/** Phrases that may not appear in copy this app renders. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /both sides/i,
    why: "the bridge has four executable routes across three reserves, not two sides",
  },
  {
    pattern: /both directions are available/i,
    why: "route availability is counted from GET /chains, not asserted about a pair",
  },
  {
    pattern: /both reserves are out of/i,
    why: "there are three reserves, and the affected ROUTES are what a reader needs",
  },
  {
    pattern: /the bridge is paused/i,
    why: "a route is unavailable; the bridge as a whole is not a pausable unit",
  },
  {
    pattern: /coming soon\s*[—-]\s*robinhood/i,
    why: "the Robinhood routes are implemented and shipped",
  },
  {
    pattern: /launches next week/i,
    why: "a dated promise that went stale the week after it was written",
  },
];

const ROOTS = ["app", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
      files.push(full);
    }
  }
  return files;
}

/** Block comments, JSX comment expressions, and whole `//` or ` * ` lines. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*");
    })
    .join("\n");
}

const repoRoot = join(__dirname, "..", "..");
const sourceFiles = ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)));

describe("no two-direction copy survives in the rendered UI", () => {
  it("scanned at least the expected number of source files", () => {
    // A guard against the scan silently finding nothing (e.g. a moved
    // directory) and the cases below passing vacuously.
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it("strips comments without swallowing the code around them", () => {
    // The stripper is load-bearing: if it over-stripped, every case below
    // would pass for the wrong reason.
    const sample = [
      "// both sides",
      " * both sides",
      "/* both sides */",
      'const url = "https://example.test/x"; const copy = "both sides";',
    ].join("\n");
    const stripped = stripComments(sample);
    expect(stripped).toContain('const copy = "both sides"');
    expect(stripped.match(/both sides/g)).toHaveLength(1);
  });

  for (const file of sourceFiles) {
    const relative = file.slice(repoRoot.length + 1);
    it(`${relative} carries no two-direction copy`, () => {
      const content = stripComments(readFileSync(file, "utf8"));
      for (const { pattern, why } of FORBIDDEN) {
        const match = pattern.exec(content);
        expect(
          match?.[0] ?? null,
          `found "${match?.[0]}" in ${relative} — ${why}`,
        ).toBeNull();
      }
    });
  }
});

describe("the exact strings the multi-route rework replaced", () => {
  /**
   * The three sentences this rework started from, scanned verbatim rather
   * than by pattern. Comments are still stripped — the modules that
   * replaced them quote each one to record what was wrong with it, and
   * those explanations are the opposite of the leftover this guards.
   */
  const RETIRED = [
    "The bridge is paused on both sides.",
    "GLC bridging with Robinhood Chain launches next week.",
    "Robinhood Network Integration",
  ] as const;

  for (const sentence of RETIRED) {
    it(`no longer renders "${sentence}"`, () => {
      for (const file of sourceFiles) {
        const content = stripComments(readFileSync(file, "utf8"));
        expect(
          content.includes(sentence),
          `${file.slice(repoRoot.length + 1)} still renders it`,
        ).toBe(false);
      }
    });
  }
});

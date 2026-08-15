import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The old bridge UI was built around a wrapped-token/federation
 * architecture that this reserve-backed bridge does not have. This test
 * scans every primary-flow source file for that vocabulary so a leftover
 * reference cannot silently ship (docs/MIGRATION_ASSESSMENT.md §"Terminology
 * removed from primary flow").
 *
 * "mint" is deliberately not in this list: it remains a legitimate noun
 * here (the Token-2022 mint address) even though the old bridge's minting
 * mechanic is gone. Forbidding the noun would produce false positives with
 * no safety value; the mechanic itself (mint/burn/wrap as a verb bridging
 * GLC into a new token) has no surviving code path to flag.
 */

const FORBIDDEN: readonly RegExp[] = [/wglc/i, /wrapped/i, /federation/i, /\bburn/i];

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

const repoRoot = join(__dirname, "..", "..");
const sourceFiles = ROOTS.flatMap((root) => collectSourceFiles(join(repoRoot, root)));

describe("no obsolete wrapped-token/federation terminology in the primary UI", () => {
  it("scanned at least the expected number of source files", () => {
    // A guard against the scan silently finding nothing (e.g. a moved
    // directory) and the test below passing vacuously.
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  for (const file of sourceFiles) {
    it(`${file.slice(repoRoot.length + 1)} has no obsolete terminology`, () => {
      const content = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        const match = content.match(pattern);
        expect(match, `found "${match?.[0]}" matching ${pattern} in ${file}`).toBeNull();
      }
    });
  }
});

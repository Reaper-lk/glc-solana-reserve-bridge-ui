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
 *
 * Every term below gets a negation carve-out: the product explicitly wants
 * to reassure users with copy like "nothing is minted, burned, or wrapped"
 * and "no federation of operators controls this bridge". A negated mention
 * is exactly the opposite of the leftover reference this test exists to
 * catch, so only an UNnegated occurrence — the word with no nearby negation
 * cue — fails.
 */

const FORBIDDEN_TERMS: readonly RegExp[] = [
  /wglc/i,
  /wrapped/i,
  /federation/i,
  /\bburn(ed|ing|s)?\b/i,
];

const NEGATION_CUE = /\b(not|never|no|n't|nothing is|does not|isn't|doesn't)\b/i;
/**
 * Characters of context to look back from a match for a negation cue.
 * Wide enough to cover a short list ("nothing is minted, burned, or
 * wrapped") without also reaching back across an unrelated sentence.
 */
const NEGATION_WINDOW = 60;

function findUnnegatedMatch(content: string, pattern: RegExp): string | null {
  const flagged = pattern.flags.includes("g")
    ? pattern
    : new RegExp(pattern.source, `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = flagged.exec(content))) {
    const start = Math.max(0, match.index - NEGATION_WINDOW);
    const before = content.slice(start, match.index);
    if (!NEGATION_CUE.test(before)) return match[0];
  }
  return null;
}

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
      for (const pattern of FORBIDDEN_TERMS) {
        const unnegated = findUnnegatedMatch(content, pattern);
        expect(
          unnegated,
          `found an un-negated "${unnegated}" in ${file} — either it's a leftover reference, or it needs a nearby negation cue (not/never/no/isn't/doesn't) to read as the reassurance it's meant to be`,
        ).toBeNull();
      }
    });
  }
});

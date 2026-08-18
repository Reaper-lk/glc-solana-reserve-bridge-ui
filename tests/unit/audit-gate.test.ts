// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The dependency-audit gate (scripts/audit-gate.mjs) enforces "any
 * high/critical advisory fails CI" with exactly two documented GHSA
 * exceptions for the build-time-only image-size transitive. These tests
 * pin the three properties that matter:
 *
 *   - the two known advisories (and only they) are accepted,
 *   - any OTHER high or critical advisory still fails the gate,
 *   - malformed or shape-drifted audit output fails CLOSED.
 *
 * Each case feeds the script a saved `npm audit --json` document through
 * its `--input` hook, so the behavior is deterministic and offline. The
 * fixtures mirror the real npm v10 report shape: a vulnerability entry's
 * `via` holds advisory OBJECTS on the package that owns the advisory and
 * plain strings on packages that are only transitively affected.
 */

const SCRIPT = fileURLToPath(new URL("../../scripts/audit-gate.mjs", import.meta.url));

const ICNS_GHSA = "GHSA-w3rx-r6r6-pgpr";
const JXL_GHSA = "GHSA-5p2g-fcmc-qvqq";

interface GateResult {
  code: number;
  output: string;
}

function runGate(document: string): GateResult {
  const dir = mkdtempSync(join(tmpdir(), "audit-gate-test-"));
  const file = join(dir, "audit.json");
  writeFileSync(file, document);
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--input", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

function advisory(ghsa: string, name: string, severity: string, title: string) {
  return {
    source: 1_000_000,
    name,
    dependency: name,
    title,
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    range: "*",
  };
}

/** A faithful miniature of this repository's actual audit report. */
function knownTreeReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "image-size": {
        name: "image-size",
        severity: "high",
        isDirect: false,
        via: [
          advisory(ICNS_GHSA, "image-size", "high", "ICNS parser infinite loop"),
          advisory(JXL_GHSA, "image-size", "high", "JXL/HEIF parser infinite loops"),
        ],
        fixAvailable: false,
      },
      metro: {
        name: "metro",
        severity: "high",
        isDirect: false,
        // Transitively affected packages reference the advisory by string
        // and carry no GHSA of their own — the gate must not double-count
        // or mistake these for suppressible entries.
        via: ["image-size"],
        fixAvailable: false,
      },
      "react-native": {
        name: "react-native",
        severity: "high",
        isDirect: false,
        via: ["@react-native/community-cli-plugin"],
        fixAvailable: false,
      },
      uuid: {
        name: "uuid",
        severity: "moderate",
        isDirect: false,
        via: [advisory("GHSA-w5hq-g745-h8pq", "uuid", "moderate", "buffer bounds")],
        fixAvailable: true,
      },
    },
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 1, high: 3, critical: 0, total: 4 },
    },
  };
}

describe("audit gate — allowlist scope", () => {
  it("accepts a report whose only high/critical advisories are the two documented image-size GHSA ids", () => {
    const result = runGate(JSON.stringify(knownTreeReport()));
    expect(result.output).toContain("audit gate passed");
    expect(result.output).toContain(ICNS_GHSA);
    expect(result.output).toContain(JXL_GHSA);
    expect(result.code).toBe(0);
  });

  it("accepts a fully clean report", () => {
    const result = runGate(
      JSON.stringify({
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 0,
            critical: 0,
            total: 0,
          },
        },
      }),
    );
    expect(result.code).toBe(0);
  });

  it("still ignores sub-high advisories, matching the previous --audit-level=high posture", () => {
    const report = knownTreeReport();
    delete (report.vulnerabilities as Record<string, unknown>)["image-size"];
    delete (report.vulnerabilities as Record<string, unknown>).metro;
    delete (report.vulnerabilities as Record<string, unknown>)["react-native"];
    report.metadata.vulnerabilities.high = 0;
    report.metadata.vulnerabilities.total = 1;
    const result = runGate(JSON.stringify(report));
    expect(result.code).toBe(0);
  });

  it("fails on an unrelated synthetic HIGH advisory even alongside the allowlisted pair", () => {
    const report = knownTreeReport();
    (report.vulnerabilities as Record<string, unknown>)["evil-package"] = {
      name: "evil-package",
      severity: "high",
      isDirect: true,
      via: [advisory("GHSA-aaaa-bbbb-cccc", "evil-package", "high", "synthetic RCE")],
      fixAvailable: false,
    };
    report.metadata.vulnerabilities.high += 1;
    const result = runGate(JSON.stringify(report));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("GHSA-aaaa-bbbb-cccc");
  });

  it("fails on an unrelated synthetic CRITICAL advisory", () => {
    const report = knownTreeReport();
    (report.vulnerabilities as Record<string, unknown>)["worse-package"] = {
      name: "worse-package",
      severity: "critical",
      isDirect: true,
      via: [
        advisory(
          "GHSA-dddd-eeee-ffff",
          "worse-package",
          "critical",
          "synthetic takeover",
        ),
      ],
      fixAvailable: false,
    };
    report.metadata.vulnerabilities.critical += 1;
    const result = runGate(JSON.stringify(report));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("GHSA-dddd-eeee-ffff");
  });

  it("fails when a NEW advisory lands on image-size itself — the exception is per-GHSA, not per-package", () => {
    const report = knownTreeReport();
    (report.vulnerabilities["image-size"].via as ReturnType<typeof advisory>[]).push(
      advisory("GHSA-gggg-hhhh-jjjj", "image-size", "high", "a third, new finding"),
    );
    const result = runGate(JSON.stringify(report));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("GHSA-gggg-hhhh-jjjj");
  });
});

describe("audit gate — fails closed on malformed input", () => {
  it("fails on unparseable JSON", () => {
    const result = runGate("npm ERR! network something went sideways");
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("not valid JSON");
  });

  it("fails on a report missing the vulnerabilities object", () => {
    const result = runGate(
      JSON.stringify({ metadata: { vulnerabilities: { high: 0 } } }),
    );
    expect(result.code).not.toBe(0);
  });

  it("fails on a report missing metadata counts", () => {
    const result = runGate(JSON.stringify({ vulnerabilities: {} }));
    expect(result.code).not.toBe(0);
  });

  it("fails on an npm-reported error document", () => {
    const result = runGate(
      JSON.stringify({ error: { code: "ENOAUDIT", summary: "registry unavailable" } }),
    );
    expect(result.code).not.toBe(0);
  });

  it("fails when counts claim high findings but no advisory objects are parseable (format drift)", () => {
    const result = runGate(
      JSON.stringify({
        vulnerabilities: {
          mystery: { name: "mystery", severity: "high", via: ["something"] },
        },
        metadata: {
          vulnerabilities: {
            info: 0,
            low: 0,
            moderate: 0,
            high: 1,
            critical: 0,
            total: 1,
          },
        },
      }),
    );
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("format drift");
  });

  it("fails when a high advisory carries no recognizable GHSA id", () => {
    const report = knownTreeReport();
    (report.vulnerabilities as Record<string, unknown>)["opaque-package"] = {
      name: "opaque-package",
      severity: "high",
      via: [
        {
          source: 1,
          name: "opaque-package",
          title: "advisory with a non-GHSA url",
          url: "https://example.com/advisory/12345",
          severity: "high",
        },
      ],
      fixAvailable: false,
    };
    report.metadata.vulnerabilities.high += 1;
    const result = runGate(JSON.stringify(report));
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("no recognizable GHSA id");
  });
});

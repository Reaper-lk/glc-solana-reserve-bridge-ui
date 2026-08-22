import { describe, expect, it } from "vitest";
import { __envSchemaForTests as envSchema } from "@/lib/config/env";

/**
 * Configuration is a safety control: a misconfigured explorer template or a
 * missing API URL should fail loudly at startup rather than render a broken
 * link to a user about to send funds.
 */

const base = {
  appUrl: "https://example.test",
  officialDomains: "example.test",
  bridgeApiMode: "mock",
  solanaCluster: "devnet",
  reserveMintAddress: "Hn6Kdxs6cJrXDLvArAief8ueTgdZLkRacLPPUZo2pump",
};

describe("public environment schema", () => {
  it("accepts a minimal mock configuration", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it("requires the canonical reserve mint address", () => {
    const { reserveMintAddress: _omit, ...rest } = base;
    expect(envSchema.safeParse(rest).success).toBe(false);
  });

  it("leaves the reserve program id optional (Solana -> Goldcoin disables with a reason, not a guess)", () => {
    expect(envSchema.safeParse(base).success).toBe(true);
    expect(
      envSchema.safeParse({
        ...base,
        reserveProgramId: "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY",
      }).success,
    ).toBe(true);
  });

  describe("retired program ids on mainnet-beta", () => {
    // Mirrors the backend's own permanently-retired denylist
    // (glc-solana-reserve-bridge: service/src/bin/glc-mainnet-bootstrap.rs):
    // the scaffold/dev id was never deployed to a public cluster, and the
    // first mainnet deployment has been closed with its rent reclaimed. A
    // mainnet config carrying either would build deposit instructions
    // against a dead program, so startup fails instead.
    const SCAFFOLD_DEV_ID = "BnCFcMaZtpXUzZhXZdQSeQWH4A2BMv5ZaebGe6Ysv2oY";
    const CLOSED_MAINNET_ID = "7h2zSJuqpmbSq4seeXDdaJChVoxhEWwA9b8qG6Ct1GNn";
    const PRODUCTION_ID = "6tmLSP2j2thito2RpByqgfKHuVRSLcNd9c5FkrLJMjja";

    it.each([SCAFFOLD_DEV_ID, CLOSED_MAINNET_ID])(
      "refuses retired id %s when the cluster is mainnet-beta",
      (retired) => {
        const result = envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          reserveProgramId: retired,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain("permanently retired");
        }
      },
    );

    it("accepts the current production id on mainnet-beta", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "mainnet-beta",
          reserveProgramId: PRODUCTION_ID,
        }).success,
      ).toBe(true);
    });

    it("still accepts the dev id on localnet, where local validators genuinely deploy at it", () => {
      expect(
        envSchema.safeParse({
          ...base,
          solanaCluster: "localnet",
          reserveProgramId: SCAFFOLD_DEV_ID,
        }).success,
      ).toBe(true);
    });
  });

  it("requires an API URL when the mode is http", () => {
    const result = envSchema.safeParse({ ...base, bridgeApiMode: "http" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "NEXT_PUBLIC_BRIDGE_API_URL is required",
      );
    }
  });

  it("accepts http mode with an API URL", () => {
    expect(
      envSchema.safeParse({
        ...base,
        bridgeApiMode: "http",
        bridgeApiUrl: "https://api.example.test",
      }).success,
    ).toBe(true);
  });

  it("parses the official domain list", () => {
    const result = envSchema.safeParse({
      ...base,
      officialDomains: "example.test, bridge.example.test ,",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.officialDomains).toEqual([
        "example.test",
        "bridge.example.test",
      ]);
    }
  });

  it("rejects an empty official domain list", () => {
    expect(envSchema.safeParse({ ...base, officialDomains: " , " }).success).toBe(false);
  });

  it("rejects an explorer template without the {value} placeholder", () => {
    const result = envSchema.safeParse({
      ...base,
      glcExplorerTxUrl: "https://explorer.example.test/tx/",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed explorer template", () => {
    expect(
      envSchema.safeParse({
        ...base,
        glcExplorerTxUrl: "https://explorer.example.test/tx/{value}",
      }).success,
    ).toBe(true);
  });

  it("rejects a relative app URL", () => {
    expect(envSchema.safeParse({ ...base, appUrl: "/bridge" }).success).toBe(false);
  });

  it("rejects an unknown Solana cluster", () => {
    expect(envSchema.safeParse({ ...base, solanaCluster: "mainnet" }).success).toBe(
      false,
    );
  });

  it("parses Goldcoin address version bytes strictly", () => {
    const result = envSchema.safeParse({ ...base, glcAddressVersions: "32, 5" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.glcAddressVersions).toEqual([32, 5]);
  });

  it("rejects a non-numeric version byte entry rather than silently dropping it", () => {
    expect(envSchema.safeParse({ ...base, glcAddressVersions: "32, abc" }).success).toBe(
      false,
    );
  });
});

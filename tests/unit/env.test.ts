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

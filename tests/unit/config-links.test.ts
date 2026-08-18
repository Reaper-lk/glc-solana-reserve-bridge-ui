import { describe, expect, it } from "vitest";
import {
  externalLinks,
  goldcoinAddressUrl,
  goldcoinTxUrl,
  officialDomains,
  primaryDomain,
  routes,
  solanaAddressUrl,
  solanaTxUrl,
} from "@/lib/config/links";

describe("explorer link builders", () => {
  it("return null when the template is not configured", () => {
    expect(goldcoinTxUrl("abc")).toBeNull();
    expect(goldcoinAddressUrl("abc")).toBeNull();
    expect(solanaTxUrl("abc")).toBeNull();
    expect(solanaAddressUrl("abc")).toBeNull();
  });
});

describe("primaryDomain", () => {
  it("derives the host from the configured app URL", () => {
    expect(primaryDomain()).toBe("localhost:3000");
  });
});

describe("officialDomains / externalLinks", () => {
  it("exposes the configured domain list", () => {
    expect(officialDomains).toContain("localhost");
  });

  it("leaves unconfigured external links undefined rather than guessed", () => {
    expect(externalLinks.protocolRepo).toBeUndefined();
  });
});

describe("routes", () => {
  it("builds a transfer route from a numeric or string id", () => {
    expect(routes.transfer(1000)).toBe("/bridge/1000");
    expect(routes.transfer("1000")).toBe("/bridge/1000");
  });

  it("builds an explorer transfer route", () => {
    expect(routes.explorerTx(1000)).toBe("/explorer/tx/1000");
  });

  it("has no reference to the obsolete federation/wglc routes", () => {
    expect(routes).not.toHaveProperty("federation");
    expect(routes).not.toHaveProperty("asset");
    expect(routes).not.toHaveProperty("incidents");
  });
});

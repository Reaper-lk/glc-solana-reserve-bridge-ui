import { describe, expect, it } from "vitest";
import {
  buildSiteIdentity,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
  toOrigin,
} from "@/lib/config/site-identity";

/**
 * The dApp's declared identity is what an automated reviewer reads when it
 * decides whether a signing surface is the app it claims to be. The failure
 * that matters is not a missing field — it is a field that names an origin
 * this deployment was never configured with.
 */

describe("toOrigin", () => {
  it("reduces a configured app URL to scheme and host", () => {
    expect(toOrigin("https://bridge.example.test")).toBe("https://bridge.example.test");
  });

  it("drops a path, query and fragment", () => {
    // A canonical URL or a manifest id that inherited a path would name a
    // different app identity than the origin the wallet sees.
    expect(toOrigin("https://bridge.example.test/app?x=1#y")).toBe(
      "https://bridge.example.test",
    );
  });

  it("drops a trailing slash", () => {
    expect(toOrigin("https://bridge.example.test/")).toBe("https://bridge.example.test");
  });

  it("keeps a non-default port", () => {
    expect(toOrigin("https://bridge.example.test:8443")).toBe(
      "https://bridge.example.test:8443",
    );
  });

  it("returns empty rather than guessing an origin from unparseable input", () => {
    expect(toOrigin("not a url")).toBe("");
    expect(toOrigin("")).toBe("");
  });
});

describe("buildSiteIdentity", () => {
  it("names the configured origin and nothing else", () => {
    const identity = buildSiteIdentity("https://bridge.example.test/somewhere");
    expect(identity.origin).toBe("https://bridge.example.test");
  });

  it("hardcodes no domain of its own", () => {
    // Every URL the UI renders originates in configuration
    // (src/lib/config/env.ts). Identity metadata is not an exception: a
    // hardcoded fallback origin here would be a domain this deployment
    // never claimed, asserted to a wallet as its canonical identity.
    const identity = buildSiteIdentity("");
    expect(identity.origin).toBe("");
  });

  it("carries a same-origin icon path, never an absolute third-party URL", () => {
    const identity = buildSiteIdentity("https://bridge.example.test");
    expect(identity.iconPath.startsWith("/")).toBe(true);
    expect(identity.iconPath).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
  });

  it("states the product name, a short name that fits a home screen, and a description", () => {
    const identity = buildSiteIdentity("https://bridge.example.test");
    expect(identity.name).toBe(SITE_NAME);
    expect(identity.shortName).toBe(SITE_SHORT_NAME);
    expect(identity.shortName.length).toBeLessThanOrEqual(12);
    expect(identity.description).toBe(SITE_DESCRIPTION);
  });

  it("declares theme colours as concrete hex, so the browser chrome is stated rather than guessed", () => {
    const identity = buildSiteIdentity("https://bridge.example.test");
    expect(identity.themeColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(identity.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});

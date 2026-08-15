import { describe, expect, it } from "vitest";
import { buildCsp, connectOriginsFrom, createNonce } from "@/lib/security/csp";

describe("buildCsp", () => {
  it("includes the nonce and strict-dynamic in script-src", () => {
    const csp = buildCsp({ nonce: "abc123", isDev: false, connectOrigins: ["'self'"] });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("adds unsafe-eval only in dev", () => {
    const dev = buildCsp({ nonce: "n", isDev: true, connectOrigins: ["'self'"] });
    const prod = buildCsp({ nonce: "n", isDev: false, connectOrigins: ["'self'"] });
    expect(dev).toContain("'unsafe-eval'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("adds upgrade-insecure-requests only in production", () => {
    const dev = buildCsp({ nonce: "n", isDev: true, connectOrigins: ["'self'"] });
    const prod = buildCsp({ nonce: "n", isDev: false, connectOrigins: ["'self'"] });
    expect(dev).not.toContain("upgrade-insecure-requests");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("includes every configured connect origin", () => {
    const csp = buildCsp({
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'", "https://api.example.test"],
    });
    expect(csp).toContain("connect-src 'self' https://api.example.test");
  });

  it("never allows object-src or framing", () => {
    const csp = buildCsp({ nonce: "n", isDev: false, connectOrigins: ["'self'"] });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("connectOriginsFrom", () => {
  it("always includes 'self'", () => {
    expect(connectOriginsFrom([])).toEqual(["'self'"]);
  });

  it("adds the origin and its websocket counterpart for each valid URL", () => {
    const origins = connectOriginsFrom(["https://api.example.test/v1"]);
    expect(origins).toContain("https://api.example.test");
    expect(origins).toContain("wss://api.example.test");
  });

  it("skips undefined candidates", () => {
    expect(connectOriginsFrom([undefined, undefined])).toEqual(["'self'"]);
  });

  it("skips a malformed URL rather than throwing", () => {
    expect(connectOriginsFrom(["not a url"])).toEqual(["'self'"]);
  });

  it("de-duplicates origins", () => {
    const origins = connectOriginsFrom([
      "https://api.example.test/v1",
      "https://api.example.test/v2",
    ]);
    expect(origins.filter((o) => o === "https://api.example.test")).toHaveLength(1);
  });
});

describe("createNonce", () => {
  it("produces a non-empty base64-ish string", () => {
    const nonce = createNonce();
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("produces a different value each call", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

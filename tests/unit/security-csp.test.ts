import { describe, expect, it, vi } from "vitest";
import { buildCsp, connectOriginsFrom, createNonce } from "@/lib/security/csp";

describe("buildCsp", () => {
  it("includes the nonce and strict-dynamic in script-src", () => {
    const csp = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "abc123",
      isDev: false,
      connectOrigins: ["'self'"],
    });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("adds unsafe-eval only in dev", () => {
    const dev = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "n",
      isDev: true,
      connectOrigins: ["'self'"],
    });
    const prod = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'"],
    });
    expect(dev).toContain("'unsafe-eval'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("adds upgrade-insecure-requests when the app is served over HTTPS", () => {
    const prod = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'"],
    });
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("omits upgrade-insecure-requests for an HTTP app URL, even in a production build", () => {
    // A production build temporarily served over plain HTTP (IP-only
    // staging, TLS terminated elsewhere) must not have its own subresource
    // requests rewritten to a non-existent https:// listener.
    const httpProd = buildCsp({
      appUrl: "http://5.0.0.1:3000",
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'"],
    });
    expect(httpProd).not.toContain("upgrade-insecure-requests");
  });

  it("omits upgrade-insecure-requests in HTTP development", () => {
    const dev = buildCsp({
      appUrl: "http://localhost:3000",
      nonce: "n",
      isDev: true,
      connectOrigins: ["'self'"],
    });
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("includes every configured connect origin", () => {
    const csp = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'", "https://api.example.test"],
    });
    expect(csp).toContain("connect-src 'self' https://api.example.test");
  });

  it("never allows object-src or framing", () => {
    const csp = buildCsp({
      appUrl: "https://bridge.example.test",
      nonce: "n",
      isDev: false,
      connectOrigins: ["'self'"],
    });
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("connectOriginsFrom", () => {
  it("admits the Robinhood deployment's RPC origin", () => {
    // The deposit preflight reads the gates that authorise a signature from
    // this endpoint (src/lib/evm/deposit.ts). Without its origin here the
    // browser blocks that read and the refusal looks like a chain fault.
    const origins = connectOriginsFrom(["https://rpc.robinhood.example/v2/some-key"]);
    expect(origins).toContain("https://rpc.robinhood.example");
  });

  it("keeps a provider key out of the policy", () => {
    // Only the origin is taken, so a key carried in the path or query of a
    // configured RPC URL never reaches a response header.
    const origins = connectOriginsFrom([
      "https://rpc.example.test/v2/secret-key?k=other",
    ]);
    expect(origins.join(" ")).not.toContain("secret-key");
    expect(origins.join(" ")).not.toContain("other");
  });

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

describe("the request policy", () => {
  it("lets the browser reach every configured chain endpoint", async () => {
    // Pins the middleware's own candidate list rather than `buildCsp` in
    // isolation: the defect this guards against was a correctly-built
    // policy that had simply never been told about Robinhood Network.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://bridge.example.test");
    vi.stubEnv("NEXT_PUBLIC_BRIDGE_API_URL", "https://api.example.test");
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "https://solana.example.test");
    vi.stubEnv("NEXT_PUBLIC_GOLDCOIN_RPC_URL", "https://goldcoin.example.test");
    vi.stubEnv("NEXT_PUBLIC_ROBINHOOD_RPC_URL", "https://robinhood.example.test/v2/key");

    const { middleware } = await import("../../middleware");
    const { NextRequest } = await import("next/server");

    const response = middleware(new NextRequest("https://bridge.example.test/bridge"));
    const csp = response.headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("https://api.example.test");
    expect(csp).toContain("https://solana.example.test");
    expect(csp).toContain("https://goldcoin.example.test");
    expect(csp).toContain("https://robinhood.example.test");
    expect(csp).not.toContain("/v2/key");

    vi.unstubAllEnvs();
  });
});

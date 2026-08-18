import { describe, expect, it } from "vitest";
import { buildDeepLinks } from "@/lib/solana/deep-links";

describe("buildDeepLinks", () => {
  it("builds a Phantom and Solflare link from env.appUrl, never window.location", () => {
    const links = buildDeepLinks("/bridge/1000");
    const ids = links.map((link) => link.id);
    expect(ids).toEqual(["phantom", "solflare"]);
    for (const link of links) {
      expect(link.url).toContain(encodeURIComponent("http://localhost:3000/bridge/1000"));
    }
  });

  it("normalises an empty path to the app root", () => {
    const links = buildDeepLinks("");
    expect(links[0]!.url).toContain(encodeURIComponent("http://localhost:3000/"));
  });

  it("rejects an absolute URL passed as a path, falling back to root", () => {
    const links = buildDeepLinks("https://evil.example/phish");
    expect(links[0]!.url).not.toContain("evil.example");
    expect(links[0]!.url).toContain(encodeURIComponent("http://localhost:3000/"));
  });

  it("rejects a protocol-relative path", () => {
    const links = buildDeepLinks("//evil.example/phish");
    expect(links[0]!.url).not.toContain("evil.example");
  });

  it("adds a leading slash to a bare path", () => {
    const links = buildDeepLinks("bridge");
    expect(links[0]!.url).toContain(encodeURIComponent("http://localhost:3000/bridge"));
  });
});

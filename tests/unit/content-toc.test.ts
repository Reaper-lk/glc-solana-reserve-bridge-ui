import { describe, expect, it } from "vitest";
import { buildToc, slugify } from "@/lib/content/toc";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Bridge Fee")).toBe("bridge-fee");
  });

  it("strips punctuation", () => {
    expect(slugify("What is the fee?")).toBe("what-is-the-fee");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });
});

describe("buildToc", () => {
  it("builds one entry per title with a derived id", () => {
    expect(buildToc(["Bridge fee", "Transfer limits"])).toEqual([
      { title: "Bridge fee", id: "bridge-fee" },
      { title: "Transfer limits", id: "transfer-limits" },
    ]);
  });

  it("disambiguates a slug collision rather than dropping it", () => {
    const toc = buildToc(["Fee", "Fee"]);
    expect(toc[0]!.id).toBe("fee");
    expect(toc[1]!.id).toBe("fee-2");
    expect(toc[0]!.id).not.toBe(toc[1]!.id);
  });

  it("returns an empty list for no titles", () => {
    expect(buildToc([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  chunkAddress,
  hasMatchingEnds,
  shortId,
  truncateMiddle,
} from "@/lib/format/address";

describe("chunkAddress", () => {
  it("splits into 4-character groups by default", () => {
    expect(chunkAddress("ABCDEFGH")).toEqual(["ABCD", "EFGH"]);
  });

  it("returns an empty array for an empty/whitespace address", () => {
    expect(chunkAddress("")).toEqual([]);
    expect(chunkAddress("   ")).toEqual([]);
  });

  it("supports a custom chunk size", () => {
    expect(chunkAddress("ABCDEF", 2)).toEqual(["AB", "CD", "EF"]);
  });

  it("rejects a chunk size below 1", () => {
    expect(() => chunkAddress("ABCD", 0)).toThrow();
  });
});

describe("truncateMiddle", () => {
  it("shortens a long value", () => {
    expect(truncateMiddle("1234567890abcdef", 6, 4)).toBe("123456…cdef");
  });

  it("returns the value unchanged when truncating would not shorten it", () => {
    expect(truncateMiddle("1234567890", 6, 4)).toBe("1234567890");
  });

  it("rejects a non-positive lead or tail", () => {
    expect(() => truncateMiddle("abc", 0, 4)).toThrow();
    expect(() => truncateMiddle("abc", 4, 0)).toThrow();
  });
});

describe("shortId", () => {
  it("truncates with an ellipsis when longer than the length", () => {
    expect(shortId("abcdefgh", 4)).toBe("abcd…");
  });

  it("returns unchanged when already short enough", () => {
    expect(shortId("abc", 4)).toBe("abc");
  });
});

describe("hasMatchingEnds", () => {
  it("is true when both first and last chunks match", () => {
    expect(hasMatchingEnds("ABCD1234WXYZ", "ABCD9999WXYZ")).toBe(true);
  });

  it("is false when the ends differ", () => {
    expect(hasMatchingEnds("ABCD1234WXYZ", "QRST1234WXYZ")).toBe(false);
  });

  it("falls back to exact equality for short values", () => {
    expect(hasMatchingEnds("ab", "ab")).toBe(true);
    expect(hasMatchingEnds("ab", "cd")).toBe(false);
  });
});

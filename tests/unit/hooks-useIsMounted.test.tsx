import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useIsMounted } from "@/lib/hooks/useIsMounted";

describe("useIsMounted", () => {
  it("reports mounted (true) once rendered in a browser-like environment", () => {
    const { result } = renderHook(() => useIsMounted());
    expect(result.current).toBe(true);
  });
});

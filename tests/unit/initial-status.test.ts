import { describe, expect, it, vi } from "vitest";

/**
 * The SSR fail-fast status fetch (src/lib/api/initial-status.ts): the
 * first-paint status snapshot must never block page rendering on an
 * offline backend. The helper passes its own 1.5-second AbortSignal —
 * composed by the HTTP client with, never replacing, the client's normal
 * 15-second timeout — and degrades every failure to `undefined`, which the
 * layout renders as the client-fetch fallback.
 */

const getStatus = vi.fn();
vi.mock("@/lib/api", () => ({
  bridgeApi: { getStatus: (...args: unknown[]) => getStatus(...args) },
}));

import { loadInitialStatus, SSR_STATUS_TIMEOUT_MS } from "@/lib/api/initial-status";
import * as fixtures from "@/lib/api/mock/fixtures";

describe("loadInitialStatus", () => {
  it("passes a fail-fast AbortSignal to getStatus", async () => {
    getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
    const result = await loadInitialStatus();
    expect(result).toBeDefined();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(getStatus.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it("uses a budget far below the client's own 15-second timeout", () => {
    expect(SSR_STATUS_TIMEOUT_MS).toBe(1_500);
  });

  it("degrades to undefined when the backend is unavailable, never throwing into the layout", async () => {
    getStatus.mockRejectedValue(new Error("connection refused"));
    await expect(loadInitialStatus()).resolves.toBeUndefined();
  });

  it("degrades to undefined when the fail-fast signal aborts a hanging request", async () => {
    // Simulate the HTTP client's behavior: it rejects when the composed
    // signal aborts. The helper must swallow that abort like any failure.
    getStatus.mockImplementation(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const result = await loadInitialStatus();
    expect(result).toBeUndefined();
  }, 10_000);
});

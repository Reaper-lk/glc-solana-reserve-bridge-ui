import { bridgeApi } from "@/lib/api";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * SSR-only fail-fast budget for the first-paint status snapshot.
 *
 * The HTTP client's own 15-second timeout is right for client-side polling,
 * but RootLayout awaits this fetch before ANY page can stream — with the
 * backend offline, every route would block for the full 15 seconds. A
 * caller-supplied 1.5-second signal (composed with the client's default via
 * `AbortSignal.any`, so the global timeout is untouched) caps that stall:
 * the page renders promptly in degraded mode and the client's normal status
 * polling takes over from there.
 */
export const SSR_STATUS_TIMEOUT_MS = 1_500;

/**
 * Fetch the status snapshot for first paint. A failure — including the
 * fail-fast timeout — degrades to the client-side fetch rather than taking
 * the page down.
 */
export async function loadInitialStatus(): Promise<BridgeStatusDto | undefined> {
  try {
    return await bridgeApi.getStatus(AbortSignal.timeout(SSR_STATUS_TIMEOUT_MS));
  } catch {
    return undefined;
  }
}

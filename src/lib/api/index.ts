import { env } from "@/lib/config/env";
import type { BridgeApiClient } from "./client";
import { HttpBridgeClient } from "./http";
import { MockBridgeClient } from "./mock/client";

export type {
  BridgeApiClient,
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "./client";
export * from "./errors";

/**
 * Composition root for the API boundary — the single place an
 * implementation is chosen. Application code imports `bridgeApi`, never a
 * concrete client.
 */

function createClient(): BridgeApiClient {
  if (env.bridgeApiMode === "http") {
    // Guaranteed present: env.ts rejects this combination at startup.
    return new HttpBridgeClient(env.bridgeApiUrl as string);
  }
  return new MockBridgeClient({ scenario: env.mockScenario });
}

export const bridgeApi: BridgeApiClient = createClient();

/** True when the UI is running on fixtures, so the shell can say so plainly. */
export const isMockMode = env.bridgeApiMode === "mock";

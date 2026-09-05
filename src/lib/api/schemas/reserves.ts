import { z } from "zod";
import {
  atomicAmountSchema,
  paginatedSchema,
  reserveDirectionSchema,
  unixSecondsSchema,
} from "./common";

/**
 * `GET /reserves/history` item — `ReserveHistoryEntry`.
 *
 * `direction` here is the *response's* spelling ("GoldcoinReserve" |
 * "SolanaReserve"), distinct from the request's `?direction=goldcoin|solana`
 * query filter — both are real, documented backend inconsistencies.
 *
 * A `classification` beginning with "SKIPPED: " means no real chain read
 * happened on that tick — treat it as a missing data point, never as a zero
 * balance.
 */
export const reserveHistoryEntrySchema = z.object({
  id: z.number().int(),
  direction: z.enum(["GoldcoinReserve", "SolanaReserve"]),
  detected_at: unixSecondsSchema,
  expected_atomic: atomicAmountSchema,
  observed_atomic: atomicAmountSchema,
  /** Signed by nature: negative when the observed balance is short. */
  delta_atomic: atomicAmountSchema,
  classification: z.string(),
  auto_paused: z.boolean(),
});

export type ReserveHistoryEntryDto = z.infer<typeof reserveHistoryEntrySchema>;

export const reserveHistoryListSchema = paginatedSchema(reserveHistoryEntrySchema);
export type ReserveHistoryListDto = z.infer<typeof reserveHistoryListSchema>;

export { reserveDirectionSchema };
export type { ReserveDirectionParam } from "./common";

import { z } from "zod";
import { paginatedSchema, reserveDirectionSchema, unixSecondsSchema } from "./common";

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
  expected_atomic: z.number().int(),
  observed_atomic: z.number().int(),
  delta_atomic: z.number().int(),
  classification: z.string(),
  auto_paused: z.boolean(),
});

export type ReserveHistoryEntryDto = z.infer<typeof reserveHistoryEntrySchema>;

export const reserveHistoryListSchema = paginatedSchema(reserveHistoryEntrySchema);
export type ReserveHistoryListDto = z.infer<typeof reserveHistoryListSchema>;

export { reserveDirectionSchema };
export type { ReserveDirectionParam } from "./common";

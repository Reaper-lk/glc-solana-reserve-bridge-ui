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
 * "SolanaReserve" | "RobinhoodReserve"), distinct from the request's
 * `?direction=goldcoin|solana` query filter — both are real, documented
 * backend inconsistencies.
 *
 * A `classification` beginning with "SKIPPED: " means no real chain read
 * happened on that tick — treat it as a missing data point, never as a zero
 * balance.
 *
 * # Why `direction` is an open string
 *
 * It was `z.enum(["GoldcoinReserve", "SolanaReserve"])`, closed, while
 * those were the only two reserves the bridge reconciled. A bridge that
 * reconciles a THIRD one puts `"RobinhoodReserve"` rows in this feed, and
 * a closed enum turns a single such row into a whole-response Zod failure
 * — which is not one missing row, it is the Reserves page replaced by
 * "The bridge returned data this page could not read."
 *
 * This is the same lesson `routeSchema` in `./common` already records for
 * `GlcToRhn`, applied to the last closed enum of its kind: parsing stays
 * total over anything structurally valid, and a spelling this build cannot
 * name is rendered VERBATIM by {@link reserveHistoryDirectionLabel} rather
 * than defaulted into one it can. Guessing here would relabel a Robinhood
 * reconciliation as a Solana one, which is worse than the error it
 * replaced because it looks correct.
 */
export const reserveHistoryEntrySchema = z.object({
  id: z.number().int(),
  direction: z.string().min(1),
  detected_at: unixSecondsSchema,
  expected_atomic: atomicAmountSchema,
  observed_atomic: atomicAmountSchema,
  /** Signed by nature: negative when the observed balance is short. */
  delta_atomic: atomicAmountSchema,
  classification: z.string(),
  auto_paused: z.boolean(),
});

export type ReserveHistoryEntryDto = z.infer<typeof reserveHistoryEntrySchema>;

/**
 * How each reserve this build knows is NAMED in the reconciliation table,
 * keyed by the response's own spelling.
 *
 * Presentation only — nothing branches on membership here except the label
 * itself, so a reserve added backend-side shows up under its wire name
 * instead of being hidden or mislabelled.
 */
const RESERVE_HISTORY_LABELS: Record<string, string> = {
  GoldcoinReserve: "Goldcoin",
  SolanaReserve: "Solana",
  RobinhoodReserve: "Robinhood",
};

/** The display name for a reconciliation row's reserve; the raw id if unknown. */
export function reserveHistoryDirectionLabel(direction: string): string {
  return RESERVE_HISTORY_LABELS[direction] ?? direction;
}

export const reserveHistoryListSchema = paginatedSchema(reserveHistoryEntrySchema);
export type ReserveHistoryListDto = z.infer<typeof reserveHistoryListSchema>;

export { reserveDirectionSchema };
export type { ReserveDirectionParam } from "./common";

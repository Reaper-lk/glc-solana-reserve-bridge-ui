import { z } from "zod";
import { directionSchema, paginatedSchema, unixSecondsSchema } from "./common";
import { requestStateSchema } from "./transfer";

/**
 * `GET /explorer/events` item — `ExplorerEvent`. Deliberately never carries a
 * counterparty address or operator identity (backend module doc,
 * service/src/api.rs) — do not add one client-side either.
 */
export const explorerEventSchema = z.object({
  id: z.number().int(),
  request_id: z.number().int(),
  direction: directionSchema,
  from_state: requestStateSchema.nullable(),
  to_state: requestStateSchema,
  at: unixSecondsSchema,
  reason: z.string().nullable(),
});

export type ExplorerEventDto = z.infer<typeof explorerEventSchema>;

export const explorerEventListSchema = paginatedSchema(explorerEventSchema);
export type ExplorerEventListDto = z.infer<typeof explorerEventListSchema>;

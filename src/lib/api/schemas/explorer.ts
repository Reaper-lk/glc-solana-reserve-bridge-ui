import { z } from "zod";
import { directionSchema, paginatedSchema, unixSecondsSchema } from "./common";

/**
 * A state name as it appears on an explorer event.
 *
 * `GET /explorer/events` is a firehose of EVERY request's history, so it is
 * the one endpoint where a single row can take the whole page down: the
 * backend adds a lifecycle state (as it did with the `Refund*` family), one
 * event carries it, `paginatedSchema` rejects the item, and the entire
 * explorer renders an error instead of the hundreds of events it could
 * still show. That is a strictly worse outcome than showing that one row
 * with its raw state name.
 *
 * So this is structural rather than enumerated: a state must look like a
 * `RequestState` identifier — a bare PascalCase-ish name, no whitespace, no
 * markup, bounded length — but need not be one this build has heard of. A
 * malformed payload (a number, null, an empty string, a sentence, a URL)
 * still fails validation exactly as before; only a plausible FUTURE state
 * gets through, and it degrades to a neutral badge showing its own name
 * (`requestStateDescriptor` in `src/lib/status`).
 *
 * Deliberately not applied to `transferViewSchema.state`: a transfer detail
 * page renders one transfer, so an unknown state there is a contract break
 * worth surfacing rather than papering over.
 */
const REQUEST_STATE_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export const eventRequestStateSchema = z.string().regex(REQUEST_STATE_NAME, {
  error: "must be a RequestState identifier",
});

/**
 * A known `RequestState`, or the raw name of one this build predates. Narrow
 * it with `isKnownRequestState` (`src/lib/bridge/state`) before indexing any
 * `Record<RequestState, …>` with it.
 */
export type EventRequestState = string;

/**
 * `GET /explorer/events` item — `ExplorerEvent`. Deliberately never carries a
 * counterparty address or operator identity (backend module doc,
 * service/src/api.rs) — do not add one client-side either.
 */
export const explorerEventSchema = z.object({
  id: z.number().int(),
  request_id: z.number().int(),
  direction: directionSchema,
  from_state: eventRequestStateSchema.nullable(),
  to_state: eventRequestStateSchema,
  at: unixSecondsSchema,
  reason: z.string().nullable(),
});

export type ExplorerEventDto = z.infer<typeof explorerEventSchema>;

export const explorerEventListSchema = paginatedSchema(explorerEventSchema);
export type ExplorerEventListDto = z.infer<typeof explorerEventListSchema>;

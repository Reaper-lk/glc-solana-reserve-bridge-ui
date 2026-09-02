import { z } from "zod";

/**
 * Primitives shared by every bridge API schema.
 *
 * Every response is validated against these before it becomes a domain
 * object. A response that does not parse is an error, not a
 * partially-trusted object handed to a component.
 *
 * The backend (`service/src/api.rs` in glc-solana-reserve-bridge) serializes
 * u64/i64 amounts as plain JSON numbers, not strings — there is no
 * alternative wire format to validate against. Very large values could in
 * principle lose precision at 2^53, a real backend characteristic rather
 * than a frontend choice; amounts are still always rendered from these
 * integers, never from a derived float.
 */

export const isoTimestampSchema = z.iso.datetime({ offset: true });

/** Unix seconds, as the bridge API reports every timestamp. */
export const unixSecondsSchema = z.number().int().nonnegative();

export const atomicAmountSchema = z.number().int().nonnegative();

/**
 * A URL the UI will render as a link.
 *
 * `z.url()` alone is not enough: it delegates to the URL constructor, which
 * happily accepts `javascript:` and `data:`. Any such value reaching an
 * `href` is a script-execution vector, so the scheme is checked here, at the
 * boundary.
 */
export const httpUrlSchema = z.url().refine((value) => /^https?:\/\//i.test(value), {
  error: "must be an http or https URL",
});

/** The chains this bridge knows about, exactly as the backend names them. */
export const chainSchema = z.enum(["goldcoin", "solana", "robinhood"]);
export type Chain = z.infer<typeof chainSchema>;

/**
 * A SETTLED transfer direction — the backend's `ledger::Direction`, which
 * is what `bridge_requests` rows, `/transfers` and `/explorer/events`
 * actually carry.
 *
 * Deliberately still two-valued, mirroring the backend: a Robinhood route
 * has no settlement machinery and can therefore never appear as a
 * transfer's direction. Widening this would let the UI parse a transfer
 * that cannot exist.
 */
export const directionSchema = z.enum(["GlcToSol", "SolToGlc"]);
export type Direction = z.infer<typeof directionSchema>;

/**
 * A ROUTE — the backend's `routes::Route`, a strict superset of
 * `Direction` covering source→destination pairs the deployment knows the
 * name of, including ones it cannot execute.
 *
 * The two types are separate for the same reason they are separate in the
 * backend: every route can be named and displayed, but only a route with a
 * corresponding `Direction` can produce a transfer.
 */
export const routeSchema = z.enum(["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"]);
export type Route = z.infer<typeof routeSchema>;

/** Every route is a valid direction name iff it is settleable. */
export function routeAsDirection(route: Route): Direction | null {
  return route === "GlcToSol" || route === "SolToGlc" ? route : null;
}

/**
 * `/reserves/history` uses a different spelling for the same two reserves —
 * a real, documented backend inconsistency (service/src/api.rs), not a typo
 * here.
 */
export const reserveDirectionSchema = z.enum(["goldcoin", "solana"]);
export type ReserveDirectionParam = z.infer<typeof reserveDirectionSchema>;

/** Cursor pagination envelope — `Page<T>` in service/src/api.rs. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
    as_of: unixSecondsSchema,
  });
}

/** The bridge API's only error shape: `{ "error": string }`, no error code. */
export const apiErrorBodySchema = z.object({
  error: z.string().min(1),
});

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

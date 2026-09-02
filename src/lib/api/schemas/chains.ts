import { z } from "zod";
import { chainSchema, routeSchema, unixSecondsSchema } from "./common";

/**
 * `GET /chains` — `ChainsView` in service/src/api.rs.
 *
 * This endpoint is the source of truth for which routes a user may start a
 * transfer on. The UI must never re-derive availability from its own
 * configuration: the backend enforces the same verdict on `POST /transfers`
 * and `POST /quote`, so anything the UI decides locally can only disagree
 * with it.
 *
 * That is also what makes enabling a route later a backend-only change —
 * no frontend deploy, no rebuild, no env var.
 */
export const chainViewSchema = z.object({
  id: chainSchema,
  display_name: z.string().min(1),
});

export type ChainViewDto = z.infer<typeof chainViewSchema>;

export const routeViewSchema = z.object({
  id: routeSchema,
  source_chain: chainSchema,
  destination_chain: chainSchema,
  /** The server's verdict. Render from this, never from local config. */
  enabled: z.boolean(),
  /**
   * Cause-agnostic copy to show when `enabled` is false. The backend
   * deliberately does not say which of its three gates refused, so this
   * never needs parsing — display it verbatim or ignore it.
   */
  disabled_reason: z.string().nullable(),
  /**
   * Whether the route has settlement machinery at all. `false` means
   * "not built yet" rather than "switched off", which is what lets the UI
   * choose "Coming soon" wording over "temporarily paused" without
   * inspecting `disabled_reason`'s prose.
   */
  implemented: z.boolean(),
});

export type RouteViewDto = z.infer<typeof routeViewSchema>;

/**
 * Keeps the entries this build understands and DROPS the ones it does not,
 * instead of rejecting the whole array.
 *
 * # Why per-entry, not whole-response, validation
 *
 * `chainSchema` and `routeSchema` are closed enums, so a strict
 * `z.array(routeViewSchema)` would fail the ENTIRE `/chains` response the
 * moment the backend learns a chain or route this bundle has never heard
 * of. Since adding chains is the explicit plan, that would turn a
 * deliberately forward-compatible backend addition into a client-side
 * outage — and, because route availability is resolved from this response,
 * an outage that reaches the live GLC↔SOL routes.
 *
 * Dropping the unknown entry instead is safe in both directions:
 *
 * - A dropped entry leaves NO route view, and a missing route view resolves
 *   to that route's structural default (`routeAvailability` in
 *   `src/lib/bridge/direction-state.ts`) — so an unknown future route is
 *   treated as unavailable, never as permitted.
 * - Entries this build DOES understand are unaffected, so a new route can
 *   never disable an existing one.
 *
 * The one thing this must not do is silently drop a MALFORMED entry for a
 * KNOWN route and thereby turn an explicit `enabled: false` into a
 * fallback-to-default. That is why the fallback is keyed on the route's own
 * `implemented`/direction rather than on a blanket "assume open".
 */
function keepParsable<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const chainsViewSchema = z
  .object({
    chains: z.array(z.unknown()),
    routes: z.array(z.unknown()),
    as_of: unixSecondsSchema,
  })
  .transform((raw) => ({
    chains: keepParsable(raw.chains, chainViewSchema),
    routes: keepParsable(raw.routes, routeViewSchema),
    as_of: raw.as_of,
  }));

export type ChainsViewDto = z.infer<typeof chainsViewSchema>;

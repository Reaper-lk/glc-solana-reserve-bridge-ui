import { z } from "zod";
import { chainSchema, routeSchema, unixSecondsSchema } from "./common";
import type { Route } from "./common";

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
 * Identity-only view of a route entry: just enough to tell WHICH route the
 * server was talking about, even when the rest of the entry is unusable.
 */
const routeIdOnlySchema = z.object({ id: routeSchema });

/**
 * Splits the server's route list into three outcomes, because "the server
 * closed this route", "the server sent something we cannot read", and "the
 * server said nothing about this route" must not be collapsed.
 *
 * | entry | outcome |
 * |---|---|
 * | validates fully | kept as a `RouteViewDto` — the server's explicit verdict |
 * | fails, but its `id` is a route THIS BUILD KNOWS | recorded in `unreadableRouteIds` — the server spoke and we could not understand it, so the route is treated as CLOSED |
 * | fails, and its `id` is unknown or unreadable | dropped — a route from a newer backend that this build has no way to render or submit anyway |
 *
 * # Why the middle case exists
 *
 * Without it, a malformed entry is indistinguishable from an absent one, and
 * an absent entry falls back to the route's structural default — which for a
 * LIVE route is "open". That would let a garbled `{"id":"GlcToSol",
 * "enabled":false}` silently reverse an operator's deliberate close. The
 * blast radius was small (the backend still returns 409 on the create path),
 * but "we could not read it" is much closer to closed than to open, and this
 * removes the ambiguity rather than reasoning about how far it propagates.
 *
 * The unknown-id case still drops, and must: those routes have no entry in
 * the local route table, cannot be selected or rendered, and fall back to a
 * structural default of closed for anything without settlement machinery.
 */
function partitionRoutes(items: readonly unknown[]): {
  routes: RouteViewDto[];
  unreadableRouteIds: Route[];
} {
  const routes: RouteViewDto[] = [];
  const unreadableRouteIds: Route[] = [];
  for (const item of items) {
    const full = routeViewSchema.safeParse(item);
    if (full.success) {
      routes.push(full.data);
      continue;
    }
    const identified = routeIdOnlySchema.safeParse(item);
    if (identified.success) unreadableRouteIds.push(identified.data.id);
  }
  return { routes, unreadableRouteIds };
}

/** Chains are display-only, so an unparseable one is simply dropped. */
function parsableChains(items: readonly unknown[]): ChainViewDto[] {
  return items.flatMap((item) => {
    const parsed = chainViewSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const chainsViewSchema = z
  .object({
    chains: z.array(z.unknown()),
    routes: z.array(z.unknown()),
    as_of: unixSecondsSchema,
  })
  .transform((raw) => {
    const { routes, unreadableRouteIds } = partitionRoutes(raw.routes);
    return {
      chains: parsableChains(raw.chains),
      routes,
      /**
       * Known route ids the server sent but this build could not parse.
       * `routeAvailable` treats these as closed. Never empty-by-default in
       * a way a caller can forget: it is part of the parsed shape, so any
       * consumer of `ChainsViewDto` has it in hand.
       */
      unreadableRouteIds,
      as_of: raw.as_of,
    };
  });

export type ChainsViewDto = z.infer<typeof chainsViewSchema>;

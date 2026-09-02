import { z } from "zod";
import { chainSchema, routeSchema, unixSecondsSchema } from "./common";

/**
 * `GET /chains` — `ChainsView` in service/src/api.rs.
 *
 * This endpoint is the ONLY source of truth for which routes a user may
 * start a transfer on. The UI must never re-derive availability from its
 * own configuration, an environment variable, or a hardcoded list: the
 * backend enforces the same verdict on `POST /transfers` and `POST /quote`,
 * so anything the UI decides locally can only ever disagree with it.
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

export const chainsViewSchema = z.object({
  chains: z.array(chainViewSchema),
  routes: z.array(routeViewSchema),
  as_of: unixSecondsSchema,
});

export type ChainsViewDto = z.infer<typeof chainsViewSchema>;

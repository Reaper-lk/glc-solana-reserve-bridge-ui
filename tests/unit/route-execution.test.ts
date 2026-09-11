import { describe, expect, it } from "vitest";
import { isRouteExecutableHere, routeExecutionSupport } from "@/lib/bridge";
import { routeSchema } from "@/lib/api/schemas/common";

/**
 * Which routes THIS BUILD can construct a source transaction for.
 *
 * # Why this is a separate question from availability
 *
 * `GET /chains` answers whether the BACKEND will admit a transfer. It cannot
 * answer whether this frontend knows how to produce the transaction that
 * starts one, and the two are genuinely different: every route is
 * implemented backend-side, and two of them are started by a wallet call
 * whose payload this build cannot yet build correctly.
 *
 * Conflating them fails badly in both directions. Reporting a route
 * unavailable because this app cannot drive it puts a UI limitation in the
 * backend's voice, and /status would then show it as a closed route — a
 * different remedy entirely. Reporting it startable because the backend says
 * `available: true` is far worse: the submit path sends a deposit, and both
 * failure modes end with a user's GLC committed on-chain and no automatic
 * way back.
 */

/** The routes this build can start today. */
const STARTABLE = ["GlcToSol", "SolToGlc", "GlcToRhn", "RhnToGlc"] as const;
/** The routes it cannot. Live on the bridge; missing a payload here. */
const NOT_STARTABLE = ["SolToRhn", "RhnToSol"] as const;

describe("routeExecutionSupport", () => {
  it.each(STARTABLE)("reports %s supported", (route) => {
    expect(routeExecutionSupport(route)).toEqual({ kind: "supported" });
    expect(isRouteExecutableHere(route)).toBe(true);
  });

  it.each(NOT_STARTABLE)("reports %s unsupported, with a reason", (route) => {
    const support = routeExecutionSupport(route);
    expect(support.kind).toBe("unsupported-here");
    if (support.kind !== "unsupported-here") return;
    expect(support.reason.length).toBeGreaterThan(0);
    expect(isRouteExecutableHere(route)).toBe(false);
  });

  it("is total over the route vocabulary, with no default arm", () => {
    // A route added to the wire enum must be a compile error in the table
    // rather than silently defaulting either way — "supported" would send a
    // deposit this build cannot encode, and "unsupported" would hide a route
    // that works.
    for (const route of routeSchema.options) {
      expect(["supported", "unsupported-here"]).toContain(
        routeExecutionSupport(route).kind,
      );
    }
    expect(routeSchema.options).toHaveLength(STARTABLE.length + NOT_STARTABLE.length);
  });
});

describe("the refusal copy", () => {
  it.each(NOT_STARTABLE)("blames this app, never the bridge, for %s", (route) => {
    // A reader who follows the link to /status will see this route reported
    // available, so copy blaming the bridge would contradict the page it
    // points at. It says the route is live and this app cannot start it.
    const support = routeExecutionSupport(route);
    if (support.kind !== "unsupported-here") throw new Error("expected a refusal");
    expect(support.reason).toMatch(/this app/i);
    expect(support.reason).toMatch(/live on the bridge/i);
  });

  it.each(NOT_STARTABLE)("states that nothing is submitted for %s", (route) => {
    // The failure this refusal prevents is an irreversible deposit, so the
    // sentence has to say that none was made — a bare "not supported" leaves
    // a reader wondering whether a wallet prompt already did something.
    const support = routeExecutionSupport(route);
    if (support.kind !== "unsupported-here") throw new Error("expected a refusal");
    expect(support.reason).toMatch(/nothing is submitted/i);
  });

  it.each(NOT_STARTABLE)("promises no date or release for %s", (route) => {
    // "Coming soon" and "in development" are exactly what this whole change
    // removed from the UI. These routes are built; what is missing is here.
    const support = routeExecutionSupport(route);
    if (support.kind !== "unsupported-here") throw new Error("expected a refusal");
    expect(support.reason).not.toMatch(/coming soon|in development|launch/i);
  });
});

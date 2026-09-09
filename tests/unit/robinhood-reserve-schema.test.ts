import { describe, expect, it } from "vitest";
import {
  isRobinhoodAvailable,
  robinhoodReserveSchema,
  ROBINHOOD_AVAILABLE,
  ROBINHOOD_NOT_CONFIGURED,
  ROBINHOOD_UNAVAILABLE,
} from "@/lib/api/schemas/robinhood";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * `GET /robinhood/reserve` at the validation boundary.
 *
 * Two properties matter more than shape here, and both are about what the
 * schema must NOT do:
 *
 *  1. Absent stays absent. Every ledger and contract figure is nullable
 *     because a deployment with no `[reserve.robinhood]` section has no
 *     reserve, and a schema that defaulted any of them to `0` would
 *     publish an empty reserve the backend explicitly declined to claim.
 *  2. An 18-decimal `uint256` survives intact. One whole GLC on Robinhood
 *     is 10^18 — already past `Number.MAX_SAFE_INTEGER` at nineteen
 *     tokens — so these can only ever be exact as strings.
 */

const now = () => new Date();
const open = () => fixtures.robinhoodReserveFixture(now, { open: true });

describe("robinhoodReserveSchema", () => {
  it("parses the shape a deployment with no Robinhood reserve actually returns", () => {
    const parsed = robinhoodReserveSchema.parse(
      fixtures.robinhoodReserveFixture(now, { open: false }),
    );
    expect(parsed.ledger_availability).toBe(ROBINHOOD_NOT_CONFIGURED);
    expect(parsed.balance_atomic).toBeNull();
    expect(parsed.available_capacity_atomic).toBeNull();
    // Not `false`. "Not paused" would be a claim about a reserve that does
    // not exist.
    expect(parsed.paused).toBeNull();
    expect(parsed.onchain.outbound_window).toBeNull();
    expect(parsed.indexer.configured).toBe(false);
  });

  it("parses the fully-available shape, both windows included", () => {
    const parsed = robinhoodReserveSchema.parse(open());
    expect(parsed.ledger_availability).toBe(ROBINHOOD_AVAILABLE);
    expect(parsed.onchain.inbound_window?.is_current).toBe(true);
    expect(parsed.routes.map((route) => route.id)).toEqual(["GlcToRhn", "RhnToGlc"]);
    // The same `RouteGate` verdict `/chains` publishes, and it is not the
    // app's availability authority — it is the same answer, not a second.
    expect(parsed.routes.every((route) => route.implemented)).toBe(true);
  });

  it("keeps an 18-decimal uint256 exact, well past Number.MAX_SAFE_INTEGER", () => {
    // 1,000,000 GLC at 18 decimals. As a JSON number this would have been
    // corrupted before any schema ran.
    const huge = "1000000000000000000000000";
    expect(Number.isSafeInteger(Number(huge))).toBe(false);
    const parsed = robinhoodReserveSchema.parse({
      ...open(),
      onchain: {
        ...open().onchain,
        outbound_window: {
          ...open().onchain.outbound_window!,
          limit_atomic: huge,
          remaining_atomic: huge,
        },
      },
    });
    expect(parsed.onchain.outbound_window?.remaining_atomic).toBe(huge);
    expect(BigInt(parsed.onchain.outbound_window!.remaining_atomic)).toBe(BigInt(huge));
  });

  it("rejects a fractional amount rather than truncating it", () => {
    expect(() =>
      robinhoodReserveSchema.parse({ ...open(), balance_atomic: "1.5" }),
    ).toThrow();
  });

  it("rejects a negative balance while allowing a negative capacity", () => {
    // A balance below zero is nonsense; a CAPACITY below zero is a real
    // diagnostic state the backend reports rather than hides.
    expect(() =>
      robinhoodReserveSchema.parse({ ...open(), balance_atomic: "-1" }),
    ).toThrow();
    expect(
      robinhoodReserveSchema.parse({ ...open(), available_capacity_atomic: "-42" })
        .available_capacity_atomic,
    ).toBe("-42");
  });

  it("does not turn a missing figure into a zero", () => {
    const parsed = robinhoodReserveSchema.parse({ ...open(), accrued_fees_atomic: null });
    expect(parsed.accrued_fees_atomic).toBeNull();
  });
});

describe("isRobinhoodAvailable", () => {
  it("accepts only the exact 'available' constant", () => {
    expect(isRobinhoodAvailable(ROBINHOOD_AVAILABLE)).toBe(true);
    expect(isRobinhoodAvailable(ROBINHOOD_NOT_CONFIGURED)).toBe(false);
    expect(isRobinhoodAvailable(ROBINHOOD_UNAVAILABLE)).toBe(false);
  });

  it("fails closed for a spelling this build has never seen", () => {
    // The verdict is permissive at the schema so one new constant cannot
    // take the status page down — and permissive only in this direction.
    expect(isRobinhoodAvailable("degraded_but_usable")).toBe(false);
    expect(isRobinhoodAvailable("Available")).toBe(false);
  });
});

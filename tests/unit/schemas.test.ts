import { describe, expect, it } from "vitest";
import {
  bridgeStatusSchema,
  publicHealthSchema,
  reserveAvailabilitySchema,
  transferLimitsSchema,
} from "@/lib/api/schemas/status";
import { bridgeStatsSchema } from "@/lib/api/schemas/stats";
import {
  transferViewSchema,
  createTransferOutputSchema,
} from "@/lib/api/schemas/transfer";
import { quoteOutputSchema } from "@/lib/api/schemas/quote";
import { explorerEventSchema } from "@/lib/api/schemas/explorer";
import { reserveHistoryEntrySchema } from "@/lib/api/schemas/reserves";
import * as fixtures from "@/lib/api/mock/fixtures";

/**
 * Every fixture must parse through the exact schema a live response would
 * — this is what keeps the mock backend from silently drifting away from
 * the real one's shape. Every schema must also REJECT a plausible-looking
 * malformed payload, since an unvalidated response reaching a component is
 * the failure mode the whole API boundary exists to prevent.
 */
describe("fixtures conform to their live-response schemas", () => {
  it("status", () => {
    expect(
      bridgeStatusSchema.safeParse(fixtures.statusFixture(() => new Date())).success,
    ).toBe(true);
    expect(bridgeStatusSchema.safeParse(fixtures.pausedStatusFixture()).success).toBe(
      true,
    );
  });
  it("limits", () => {
    expect(transferLimitsSchema.safeParse(fixtures.limitsFixture()).success).toBe(true);
  });
  it("reserve", () => {
    expect(reserveAvailabilitySchema.safeParse(fixtures.reserveFixture()).success).toBe(
      true,
    );
    expect(
      reserveAvailabilitySchema.safeParse(fixtures.insufficientReserveFixture()).success,
    ).toBe(true);
  });
  it("health", () => {
    expect(publicHealthSchema.safeParse(fixtures.healthFixture()).success).toBe(true);
  });
  it("stats", () => {
    expect(bridgeStatsSchema.safeParse(fixtures.statsFixture()).success).toBe(true);
  });
  it("transfers", () => {
    for (const transfer of fixtures.transfersFixture()) {
      expect(transferViewSchema.safeParse(transfer).success).toBe(true);
    }
  });
  it("explorer events", () => {
    for (const event of fixtures.explorerEventsFixture()) {
      expect(explorerEventSchema.safeParse(event).success).toBe(true);
    }
  });
  it("reserve history", () => {
    for (const entry of fixtures.reserveHistoryFixture()) {
      expect(reserveHistoryEntrySchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe("schemas reject malformed backend responses", () => {
  it("rejects an unknown RequestState value", () => {
    const malformed = { ...fixtures.transfersFixture()[0], state: "TotallyMadeUp" };
    expect(transferViewSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a float amount where an integer atomic amount is required", () => {
    const malformed = { ...fixtures.transfersFixture()[0], gross_amount_atomic: 12.5 };
    expect(transferViewSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a create-transfer output missing deposit_binding_hex", () => {
    const malformed = { request_id: 1, deposit_vault_address: "abc" };
    expect(createTransferOutputSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects a quote missing display-amount strings", () => {
    const malformed = {
      direction: "GlcToSol",
      gross_amount: 100,
      fee_bps: 100,
      fee_amount: 1,
      net_amount: 99,
      source_decimals: 8,
      destination_decimals: 6,
      source_asset: "GLC (Goldcoin)",
      destination_asset: "GLC (Solana)",
    };
    expect(quoteOutputSchema.safeParse(malformed).success).toBe(false);
  });

  it("rejects completely empty JSON", () => {
    expect(bridgeStatusSchema.safeParse({}).success).toBe(false);
    expect(bridgeStatsSchema.safeParse(null).success).toBe(false);
  });
});

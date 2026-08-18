import { describe, expect, it } from "vitest";
import { directions, oppositeDirection } from "@/lib/bridge/direction";

describe("oppositeDirection", () => {
  it("flips GlcToSol to SolToGlc and back", () => {
    expect(oppositeDirection("GlcToSol")).toBe("SolToGlc");
    expect(oppositeDirection("SolToGlc")).toBe("GlcToSol");
  });
});

describe("directions table", () => {
  it("each direction's destination reserve matches the backend's Direction::destination_reserve()", () => {
    expect(directions.GlcToSol.destinationReserve).toBe("solana");
    expect(directions.SolToGlc.destinationReserve).toBe("goldcoin");
  });

  it("Goldcoin GLC uses 8 decimals and Solana GLC uses 6, on both sides", () => {
    expect(directions.GlcToSol.from.token.decimals).toBe(8);
    expect(directions.GlcToSol.to.token.decimals).toBe(6);
    expect(directions.SolToGlc.from.token.decimals).toBe(6);
    expect(directions.SolToGlc.to.token.decimals).toBe(8);
  });
});

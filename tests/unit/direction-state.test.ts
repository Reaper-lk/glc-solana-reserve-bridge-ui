import { describe, expect, it } from "vitest";
import {
  directionGateState,
  QUOTA_EXHAUSTED_BODY,
  QUOTA_EXHAUSTED_TITLE,
  QUOTA_PAUSED_BODY,
  QUOTA_PAUSED_NEXT,
  QUOTA_PAUSED_TITLE,
  rollingVolumeRemaining,
} from "@/lib/bridge";
import type { BridgeStatusDto } from "@/lib/api/schemas/status";

/**
 * Per-direction state derivation for the quota/pause/refill workflow.
 * These states drive which approved message the user sees, so the
 * derivation is pinned directly: each backend field combination maps to
 * exactly one state, and each direction is derived independently — one
 * direction's exhaustion or pause never affects the other.
 */

function status(overrides: Partial<BridgeStatusDto> = {}): BridgeStatusDto {
  return {
    goldcoin_paused: false,
    solana_paused: false,
    vault_address: "GLCVau1t111111111111111111111111111111111",
    next_solana_obligation_index: 1,
    glc_to_sol_available: true,
    sol_to_glc_available: true,
    glc_to_sol_quota_exhausted: false,
    sol_to_glc_quota_exhausted: false,
    glc_to_sol_rolling_volume_remaining: "100000000000",
    sol_to_glc_rolling_volume_remaining: "100000000000",
    ...overrides,
  };
}

describe("directionGateState", () => {
  it("reports both directions active on a healthy status", () => {
    expect(directionGateState(status(), "GlcToSol")).toBe("active");
    expect(directionGateState(status(), "SolToGlc")).toBe("active");
  });

  it("reports quota-exhausted for GlcToSol alone, leaving SolToGlc active", () => {
    const s = status({
      glc_to_sol_available: false,
      glc_to_sol_quota_exhausted: true,
      glc_to_sol_rolling_volume_remaining: "40000000",
    });
    expect(directionGateState(s, "GlcToSol")).toBe("quota-exhausted");
    expect(directionGateState(s, "SolToGlc")).toBe("active");
  });

  it("reports quota-exhausted for SolToGlc alone, leaving GlcToSol active", () => {
    const s = status({
      sol_to_glc_available: false,
      sol_to_glc_quota_exhausted: true,
      sol_to_glc_rolling_volume_remaining: "0",
    });
    expect(directionGateState(s, "SolToGlc")).toBe("quota-exhausted");
    expect(directionGateState(s, "GlcToSol")).toBe("active");
  });

  it("reports quota-paused when exhaustion and the operator pause coincide (the refill wait)", () => {
    const s = status({
      glc_to_sol_available: false,
      glc_to_sol_quota_exhausted: true,
      glc_to_sol_rolling_volume_remaining: "0",
      solana_paused: true,
    });
    expect(directionGateState(s, "GlcToSol")).toBe("quota-paused");
    expect(directionGateState(s, "SolToGlc")).toBe("active");
  });

  it("maps each direction's pause to its DESTINATION reserve flag", () => {
    // GlcToSol delivers to the Solana reserve; SolToGlc to the Goldcoin one.
    const solanaPaused = status({ solana_paused: true, glc_to_sol_available: false });
    expect(directionGateState(solanaPaused, "GlcToSol")).toBe("operator-paused");
    expect(directionGateState(solanaPaused, "SolToGlc")).toBe("active");

    const goldcoinPaused = status({
      goldcoin_paused: true,
      sol_to_glc_available: false,
    });
    expect(directionGateState(goldcoinPaused, "SolToGlc")).toBe("operator-paused");
    expect(directionGateState(goldcoinPaused, "GlcToSol")).toBe("active");
  });

  it("reports capacity-constrained when unavailable with quota headroom and no pause", () => {
    const s = status({ glc_to_sol_available: false });
    expect(directionGateState(s, "GlcToSol")).toBe("capacity-constrained");
  });

  it("reads each direction's own rolling remaining", () => {
    const s = status({
      glc_to_sol_rolling_volume_remaining: "17500000000",
      sol_to_glc_rolling_volume_remaining: "82500000000",
    });
    expect(rollingVolumeRemaining(s, "GlcToSol")).toBe("17500000000");
    expect(rollingVolumeRemaining(s, "SolToGlc")).toBe("82500000000");
  });
});

describe("approved quota copy", () => {
  const all = [
    QUOTA_EXHAUSTED_TITLE,
    QUOTA_EXHAUSTED_BODY,
    QUOTA_PAUSED_TITLE,
    QUOTA_PAUSED_BODY,
    QUOTA_PAUSED_NEXT,
  ].join(" ");

  it("matches the approved wording exactly", () => {
    expect(`${QUOTA_EXHAUSTED_TITLE} ${QUOTA_EXHAUSTED_BODY}`).toBe(
      "24-hour bridge capacity reached for this direction. New transfers are temporarily unavailable.",
    );
    expect(`${QUOTA_PAUSED_TITLE}\n${QUOTA_PAUSED_BODY}\n${QUOTA_PAUSED_NEXT}`).toBe(
      "Bridge capacity reached for this direction.\nTransfers are temporarily paused while reserves are replenished.\nPlease check the official Telegram for reopening updates.",
    );
  });

  it("never promises an automatic reset or reopening", () => {
    expect(all).not.toMatch(/midnight/i);
    expect(all).not.toMatch(/automatic/i);
    expect(all).not.toMatch(/resets?\s+(at|in)/i);
    expect(all).not.toMatch(/reopens?\s+in/i);
    expect(all).not.toMatch(/refills?\s+(at|in|automatically)/i);
  });
});

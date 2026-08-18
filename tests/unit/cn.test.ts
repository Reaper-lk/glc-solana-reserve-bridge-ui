import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils/cn";

/**
 * Regression coverage for the tailwind-merge configuration in cn().
 *
 * Stock tailwind-merge does not know this project's custom type scale and
 * classifies an unknown `text-x` as a text COLOR — which silently dropped
 * `text-white` from the primary Button (ink-on-ink, invisible label),
 * StatusBadge tone colors, and Alert/stepper heading sizes wherever a size
 * and a color met in one cn() call. cn.ts declares the full scale as
 * font-size classes; these tests pin that behavior.
 */
describe("cn — custom type-scale tokens are sizes, not colors", () => {
  it("keeps a text color alongside a type-scale size (Button primary regression)", () => {
    expect(cn("bg-ink-950 text-white", "h-12 text-body-lg")).toContain("text-white");
  });

  it("keeps a tone color alongside the badge size (StatusBadge regression)", () => {
    const merged = cn("bg-success-50 text-success-700", "text-body-sm px-2");
    expect(merged).toContain("text-success-700");
    expect(merged).toContain("text-body-sm");
  });

  it("keeps a heading size alongside a color (Alert title regression)", () => {
    const merged = cn("text-heading-2 text-ink-950");
    expect(merged).toContain("text-heading-2");
    expect(merged).toContain("text-ink-950");
  });

  it("still resolves two type-scale sizes last-wins", () => {
    expect(cn("text-body text-body-sm")).toBe("text-body-sm");
  });

  it("still resolves two text colors last-wins", () => {
    expect(cn("text-ink-500 text-ink-700")).toBe("text-ink-700");
  });

  it("still resolves stock font sizes against the custom scale last-wins", () => {
    expect(cn("text-sm text-body-lg")).toBe("text-body-lg");
    expect(cn("text-body-lg text-sm")).toBe("text-sm");
  });
});

import { describe, expect, it } from "vitest";
import { canOfferInstall, detectPlatform, needsDeepLink } from "@/lib/solana/platform";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko); wv) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("detectPlatform", () => {
  it("reports desktop for a plain desktop user agent with no injection", () => {
    expect(detectPlatform({ userAgent: DESKTOP_UA, hasInjectedWallet: false })).toBe(
      "desktop",
    );
  });

  it("reports desktop when the user agent is unavailable", () => {
    expect(detectPlatform({ userAgent: null, hasInjectedWallet: false })).toBe("desktop");
  });

  it("reports android for Android Chrome outside a WebView", () => {
    expect(
      detectPlatform({ userAgent: ANDROID_CHROME_UA, hasInjectedWallet: false }),
    ).toBe("android");
  });

  it("reports unsupported-webview for Android inside a WebView", () => {
    expect(
      detectPlatform({ userAgent: ANDROID_WEBVIEW_UA, hasInjectedWallet: false }),
    ).toBe("unsupported-webview");
  });

  it("reports ios for iOS Safari", () => {
    expect(detectPlatform({ userAgent: IOS_SAFARI_UA, hasInjectedWallet: false })).toBe(
      "ios",
    );
  });

  it("reports wallet-browser when injected on a mobile user agent", () => {
    expect(detectPlatform({ userAgent: IOS_SAFARI_UA, hasInjectedWallet: true })).toBe(
      "wallet-browser",
    );
  });

  it("reports desktop when injected on a desktop user agent, even though injected", () => {
    expect(detectPlatform({ userAgent: DESKTOP_UA, hasInjectedWallet: true })).toBe(
      "desktop",
    );
  });

  it("treats injection as desktop when the user agent is unavailable", () => {
    expect(detectPlatform({ userAgent: null, hasInjectedWallet: true })).toBe("desktop");
  });
});

describe("needsDeepLink", () => {
  it("is true only for iOS", () => {
    expect(needsDeepLink("ios")).toBe(true);
    expect(needsDeepLink("android")).toBe(false);
    expect(needsDeepLink("desktop")).toBe(false);
    expect(needsDeepLink("wallet-browser")).toBe(false);
    expect(needsDeepLink("unsupported-webview")).toBe(false);
  });
});

describe("canOfferInstall", () => {
  it("is true only where an extension can actually be added", () => {
    expect(canOfferInstall("desktop")).toBe(true);
    expect(canOfferInstall("wallet-browser")).toBe(true);
    expect(canOfferInstall("android")).toBe(false);
    expect(canOfferInstall("ios")).toBe(false);
    expect(canOfferInstall("unsupported-webview")).toBe(false);
  });
});

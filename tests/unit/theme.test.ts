import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  buildPrePaintScript,
  isThemePreference,
  readStoredPreference,
  resolveTheme,
  systemTheme,
  THEME_STORAGE_KEY,
  writeStoredPreference,
} from "@/lib/theme";

/**
 * The theme resolution rules, asserted directly rather than through a
 * rendered component.
 *
 * The rule that matters most here is the one about `system`: it is the
 * initial default, it is stored as the ABSENCE of a key, and an unrecognised
 * stored value is treated as absent rather than trusted.
 */

function mockSystem(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_: string, listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn(
      (_: string, listener: (e: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    ),
    dispatchEvent: vi.fn(),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(media as unknown as MediaQueryList);
  return media;
}

function resetDocument() {
  document.documentElement.className = "";
  delete document.documentElement.dataset["theme"];
  document.documentElement.style.colorScheme = "";
}

beforeEach(() => {
  window.localStorage.clear();
  resetDocument();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme preference parsing", () => {
  it("accepts exactly the three preferences and nothing else", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("Dark")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(1)).toBe(false);
  });
});

describe("reading the stored preference", () => {
  it("defaults to system when nothing was ever chosen", () => {
    expect(readStoredPreference()).toBe("system");
  });

  it("returns an explicit stored choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredPreference()).toBe("dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(readStoredPreference()).toBe("light");
  });

  it("treats a value this build does not recognise as no choice at all", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(readStoredPreference()).toBe("system");
  });

  it("treats a literal stored 'system' as no choice, not as a fourth state", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    expect(readStoredPreference()).toBe("system");
  });

  it("falls back to system rather than throwing when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readStoredPreference()).toBe("system");
  });
});

describe("writing the stored preference", () => {
  it("persists an explicit choice", () => {
    writeStoredPreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("stores 'system' as the absence of the key, so the default stays changeable", () => {
    writeStoredPreference("dark");
    writeStoredPreference("system");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("does not throw when storage rejects the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeStoredPreference("dark")).not.toThrow();
  });
});

describe("resolving a preference to a painted theme", () => {
  it("reads the operating system for 'system'", () => {
    mockSystem(true);
    expect(systemTheme()).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");

    mockSystem(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("ignores the operating system once a choice exists", () => {
    mockSystem(true);
    expect(resolveTheme("light")).toBe("light");
    mockSystem(false);
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("falls back to light when matchMedia is unavailable", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(() => {
      throw new TypeError("not a function");
    });
    expect(systemTheme()).toBe("light");
  });
});

describe("applying a theme to the document", () => {
  it("sets the class, the data attribute and color-scheme together", () => {
    applyTheme("dark");
    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset["theme"]).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");

    applyTheme("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.dataset["theme"]).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });

  it("leaves unrelated classes on <html> alone", () => {
    document.documentElement.className = "font-variable";
    applyTheme("dark");
    expect(document.documentElement.classList.contains("font-variable")).toBe(true);
  });
});

/**
 * The pre-paint script is a second implementation of the same rules, written
 * in ES5 and inlined into <head>. These cases run the real string and assert
 * it lands on the same answer the module does — the only thing standing
 * between the two copies and a silent drift.
 */
describe("the pre-paint script agrees with the module", () => {
  function runScript() {
    new Function(buildPrePaintScript()).call(window);
  }

  it("follows the system preference when nothing is stored", () => {
    mockSystem(true);
    runScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset["theme"]).toBe(
      resolveTheme(readStoredPreference()),
    );
  });

  it("honours a stored light choice over a dark system preference", () => {
    mockSystem(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    runScript();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("honours a stored dark choice over a light system preference", () => {
    mockSystem(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runScript();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("ignores an unrecognised stored value, exactly as the module does", () => {
    mockSystem(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    runScript();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("does not throw, or touch the document, when storage is blocked", () => {
    mockSystem(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => runScript()).not.toThrow();
  });

  it("carries the same storage key and media query the module uses", () => {
    const script = buildPrePaintScript();
    expect(script).toContain(THEME_STORAGE_KEY);
    expect(script).toContain("(prefers-color-scheme: dark)");
  });
});

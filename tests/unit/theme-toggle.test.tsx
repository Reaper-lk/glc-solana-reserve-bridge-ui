import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { resetThemeStoreForTests, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * The control's behavioural contract, end to end through the store:
 *
 *   - a first visit follows the operating system,
 *   - an explicit choice wins over the operating system and survives a reload,
 *   - switching applies immediately, with no navigation,
 *   - and none of it crashes or mismatches when the page is server-rendered
 *     and then hydrated.
 */

let systemPrefersDark = false;
const mediaListeners = new Set<(event: MediaQueryListEvent) => void>();

function installMatchMedia() {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("dark") ? systemPrefersDark : false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
          mediaListeners.add(listener);
        },
        removeEventListener: (_: string, listener: (e: MediaQueryListEvent) => void) => {
          mediaListeners.delete(listener);
        },
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

/** The state a fresh page load starts from, keeping localStorage intact. */
function simulateReload() {
  resetThemeStoreForTests();
  document.documentElement.className = "";
  delete document.documentElement.dataset["theme"];
  document.documentElement.style.colorScheme = "";
}

const isDark = () => document.documentElement.classList.contains("dark");
const sun = () => screen.getByRole("button", { name: "Light theme" });
const moon = () => screen.getByRole("button", { name: "Dark theme" });

beforeEach(() => {
  window.localStorage.clear();
  mediaListeners.clear();
  systemPrefersDark = false;
  simulateReload();
  installMatchMedia();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initial theme", () => {
  it("follows a dark system preference when nothing has been chosen", () => {
    systemPrefersDark = true;
    render(<ThemeToggle />);

    expect(isDark()).toBe(true);
    expect(moon()).toHaveAttribute("aria-pressed", "true");
    expect(sun()).toHaveAttribute("aria-pressed", "false");
    // Following the system is not a choice, so nothing is written down.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("follows a light system preference when nothing has been chosen", () => {
    systemPrefersDark = false;
    render(<ThemeToggle />);

    expect(isDark()).toBe(false);
    expect(sun()).toHaveAttribute("aria-pressed", "true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("tracks the system flipping while the page is open and unpinned", () => {
    systemPrefersDark = false;
    render(<ThemeToggle />);
    expect(isDark()).toBe(false);

    systemPrefersDark = true;
    act(() => {
      for (const listener of mediaListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(isDark()).toBe(true);
    expect(moon()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("a persisted choice", () => {
  it("applies a stored light choice over a dark system preference", () => {
    systemPrefersDark = true;
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<ThemeToggle />);

    expect(isDark()).toBe(false);
    expect(sun()).toHaveAttribute("aria-pressed", "true");
  });

  it("applies a stored dark choice over a light system preference", () => {
    systemPrefersDark = false;
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    expect(isDark()).toBe(true);
    expect(moon()).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("is not disturbed by the system flipping once it has been pinned", () => {
    systemPrefersDark = false;
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    systemPrefersDark = true;
    act(() => {
      for (const listener of mediaListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    expect(isDark()).toBe(true);

    systemPrefersDark = false;
    act(() => {
      for (const listener of mediaListeners) {
        listener({ matches: false } as MediaQueryListEvent);
      }
    });
    expect(isDark()).toBe(true);
  });
});

describe("switching themes", () => {
  it("applies dark immediately and records the choice", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(isDark()).toBe(false);

    await user.click(moon());

    expect(isDark()).toBe(true);
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(moon()).toHaveAttribute("aria-pressed", "true");
    expect(sun()).toHaveAttribute("aria-pressed", "false");
  });

  it("switches back to light and records that too", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    await user.click(sun());

    expect(isDark()).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("pins the current theme when the already-active segment is pressed", async () => {
    const user = userEvent.setup();
    systemPrefersDark = true;
    render(<ThemeToggle />);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    await user.click(moon());

    expect(isDark()).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("is operable from the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.tab();
    expect(sun()).toHaveFocus();
    await user.tab();
    expect(moon()).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(isDark()).toBe(true);

    await user.tab({ shift: true });
    expect(sun()).toHaveFocus();
    await user.keyboard(" ");
    expect(isDark()).toBe(false);
  });
});

describe("persistence across a reload", () => {
  it("keeps an explicit dark choice", async () => {
    const user = userEvent.setup();
    const first = render(<ThemeToggle />);
    await user.click(moon());
    expect(isDark()).toBe(true);
    first.unmount();

    simulateReload();
    expect(isDark()).toBe(false); // the fresh document, before anything runs

    render(<ThemeToggle />);
    expect(isDark()).toBe(true);
    expect(moon()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps an explicit light choice even when the system asks for dark", async () => {
    const user = userEvent.setup();
    systemPrefersDark = true;
    const first = render(<ThemeToggle />);
    await user.click(sun());
    first.unmount();

    simulateReload();
    render(<ThemeToggle />);

    expect(isDark()).toBe(false);
    expect(sun()).toHaveAttribute("aria-pressed", "true");
  });
});

describe("server rendering and hydration", () => {
  it("renders on the server without touching the browser-only globals", () => {
    // The store's server snapshot is what makes this safe: no localStorage
    // read, no matchMedia call, no document access during the render pass.
    const storage = vi.spyOn(Storage.prototype, "getItem");
    const media = vi.spyOn(window, "matchMedia");
    // The jsdom setup file installs a shared `matchMedia` mock whose call
    // history outlives a single test, so the count starts from here.
    storage.mockClear();
    media.mockClear();

    const html = renderToString(<ThemeToggle />);

    expect(html).toContain("Light theme");
    expect(html).toContain("Dark theme");
    expect(storage).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
  });

  it("hydrates server markup with a stored dark choice without a mismatch", async () => {
    systemPrefersDark = false;
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    const container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeToggle />);
    document.body.append(container);

    await act(async () => {
      hydrateRoot(container, <ThemeToggle />);
    });

    // No hydration warning, and the stored choice has taken effect.
    expect(errors).toEqual([]);
    expect(isDark()).toBe(true);
    expect(
      container.querySelector('[aria-label="Dark theme"]')?.getAttribute("aria-pressed"),
    ).toBe("true");

    container.remove();
  });
});

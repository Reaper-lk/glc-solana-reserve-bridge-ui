/**
 * Theme model.
 *
 * Three states, not two. `system` is the initial default — a visitor who has
 * never touched the control gets whatever their operating system already
 * asked for — and it stops being the answer the moment they choose, which is
 * the only choice this module persists.
 *
 * Everything here is a pure function of its inputs plus the two browser
 * facilities it names (`localStorage`, `matchMedia`), so the resolution rules
 * can be asserted directly rather than inferred from a rendered component.
 * Both facilities are guarded: `localStorage` throws outright in a Safari
 * private window and in an embedded webview with storage disabled, and a
 * theme control is not a good enough reason to take the page down.
 */

export type ThemePreference = "light" | "dark" | "system";

/** What is actually painted. `system` has been resolved away. */
export type ResolvedTheme = "light" | "dark";

/**
 * Namespaced, because this origin also carries the Solana wallet adapter's
 * own `localStorage` keys and a bare `theme` would be a collision waiting to
 * happen.
 */
export const THEME_STORAGE_KEY = "glc-bridge-theme";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** The class the whole token system keys off — see app/globals.css. */
export const DARK_CLASS = "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The stored preference, or `system` when nothing was ever chosen.
 *
 * A value that is present but not one this build recognises (a downgrade, a
 * hand-edited entry) is treated as absent rather than trusted.
 */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) && stored !== "system" ? stored : "system";
  } catch {
    return "system";
  }
}

/**
 * Persists an explicit choice. `system` is stored as the ABSENCE of a key,
 * not as the string "system": "I have no preference" and "I chose to follow
 * the system" are the same state, and writing one of them down would make a
 * future change to the default silently unreachable for existing visitors.
 */
export function writeStoredPreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage unavailable. The choice still applies to this page view; it
    // just will not outlive it. Failing the interaction would be worse.
  }
}

/** What the operating system is asking for right now. */
export function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/**
 * Puts the resolved theme on <html>.
 *
 * Three things, and all three matter:
 *   - the `dark` class, which every design token in globals.css keys off;
 *   - `data-theme`, which states the resolved theme in one readable place
 *     for tests and for anything debugging a screenshot;
 *   - `color-scheme`, which is what actually turns the scrollbars, the date
 *     picker and the form-control chrome dark. CSS variables cannot reach
 *     any of those.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, resolved === "dark");
  root.dataset["theme"] = resolved;
  root.style.colorScheme = resolved;
}

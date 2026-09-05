"use client";

import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  applyTheme,
  DARK_MEDIA_QUERY,
  readStoredPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredPreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";
import { SERVER_RENDERED_THEME } from "./pre-paint-script";

/**
 * Theme state as a module-level store rather than a React context.
 *
 * There is exactly one <html> element, so there is exactly one theme; a
 * provider would add a boundary to the layout and a re-render to every
 * consumer for a value that is genuinely global. `useSyncExternalStore` also
 * gives the server snapshot for free, which is what keeps hydration honest:
 * the first client render returns the same value the server rendered, and the
 * real preference arrives in the commit that follows.
 */

export interface ThemeState {
  /** What the user chose. `system` means "follow the operating system". */
  readonly preference: ThemePreference;
  /** What is actually painted right now. */
  readonly resolved: ResolvedTheme;
}

/**
 * The snapshot React uses while server-rendering and, crucially, during
 * hydration — frozen and shared so its identity never changes.
 */
const SERVER_STATE: ThemeState = Object.freeze({
  preference: "system" as ThemePreference,
  resolved: SERVER_RENDERED_THEME,
});

const listeners = new Set<() => void>();

let state: ThemeState = SERVER_STATE;
let initialised = false;

/**
 * `useSyncExternalStore` requires a snapshot that is stable between calls
 * when nothing changed, so the object is built once and then replaced only on
 * a real transition.
 */
function getSnapshot(): ThemeState {
  if (!initialised) {
    initialised = true;
    const preference = readStoredPreference();
    state = { preference, resolved: resolveTheme(preference) };
  }
  return state;
}

function getServerSnapshot(): ThemeState {
  return SERVER_STATE;
}

function commit(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  if (state.preference === preference && state.resolved === resolved) return;

  state = { preference, resolved };
  applyTheme(resolved);
  for (const notify of listeners) notify();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  // Attached once, for the lifetime of the first subscriber onwards. Both
  // sources are cheap and both are real: another tab can change the stored
  // choice, and the operating system can flip its own scheme at sunset while
  // this tab sits open on `system`.
  const media = window.matchMedia(DARK_MEDIA_QUERY);

  // The preference has not changed, only what it resolves to, so this goes
  // through the same commit path — which no-ops unless the resolution moved.
  const onSystemChange = () => {
    if (state.preference === "system") commit("system");
  };

  const onStorage = (event: StorageEvent) => {
    // `key === null` is a whole-storage clear, which also concerns us.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    commit(readStoredPreference());
  };

  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onStoreChange);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The re-apply below has to happen before paint, but React logs a warning for
 * `useLayoutEffect` during server rendering (where it cannot run at all), so
 * the choice is made once at module scope. The branch is constant per
 * environment, so this is not a conditional hook.
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useTheme(): ThemeState & {
  setPreference: (preference: ThemePreference) => void;
  toggle: () => void;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /*
   * Re-assert the theme onto <html> after mount.
   *
   * In production this is a no-op: the pre-paint script already did it. It
   * earns its place in two cases. First, React's Strict Mode remount in
   * development resets <html> to only the attributes it manages from JSX,
   * dropping the class the script set. Second, if the inline script is ever
   * blocked (a policy without our nonce, a stripping proxy), this is what
   * still gets the right theme onto the page — one frame late instead of
   * never.
   */
  useIsomorphicLayoutEffect(() => {
    applyTheme(current.resolved);
  }, [current.resolved]);

  const setPreference = useCallback((preference: ThemePreference) => {
    writeStoredPreference(preference);
    commit(preference);
  }, []);

  const toggle = useCallback(() => {
    // Toggling acts on what the user can SEE, not on the stored preference:
    // from `system` resolving to dark, "toggle" must mean light.
    setPreference(state.resolved === "dark" ? "light" : "dark");
  }, [setPreference]);

  return { ...current, setPreference, toggle };
}

/**
 * Test seam. The store is module state by design, and a test that switches
 * themes would otherwise leak into the next one.
 */
export function resetThemeStoreForTests(): void {
  listeners.clear();
  state = SERVER_STATE;
  initialised = false;
}

import {
  DARK_CLASS,
  DARK_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
} from "./theme";

/**
 * The pre-paint theme script.
 *
 * This is the whole answer to "no flash of the wrong theme". React cannot
 * help here: `useEffect` runs after paint, and even `useLayoutEffect` runs
 * only after hydration — on a slow connection the browser has already
 * painted the server's HTML by then. A synchronous inline script in <head>
 * runs while the document is still being PARSED, before the first paint,
 * which is the only point early enough.
 *
 * Built from the same constants the runtime module uses, so the key, the
 * media query and the class name cannot drift apart between the two
 * implementations of this rule. `tests/unit/theme-pre-paint.test.ts`
 * executes this string against the module and asserts they agree.
 *
 * It is deliberately dependency-free, ES5, and enclosed in try/catch: it runs
 * before any bundle exists, and a theme preference is never a good enough
 * reason to abort parsing the document.
 */
export function buildPrePaintScript(): string {
  return (
    `(function(){try{` +
    `var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    `var t=(s==="light"||s==="dark")?s:` +
    `(matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches?"dark":"light");` +
    `var e=document.documentElement;` +
    `e.classList.toggle(${JSON.stringify(DARK_CLASS)},t==="dark");` +
    `e.setAttribute("data-theme",t);` +
    `e.style.colorScheme=t;` +
    `}catch(_){}})();`
  );
}

/**
 * The theme the server renders with.
 *
 * The server cannot know the answer — `localStorage` is not sent with the
 * request and neither is `prefers-color-scheme` — so it renders light and
 * the script above corrects the document before anyone sees it. Named here
 * rather than left implicit so the SSR contract is stated in one place.
 */
export const SERVER_RENDERED_THEME: ResolvedTheme = "light";

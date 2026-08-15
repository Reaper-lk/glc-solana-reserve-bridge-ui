"use client";

import { useSyncExternalStore } from "react";

/**
 * Hydration gate.
 *
 * Wallet detection reads `window`, so the server cannot know what the client
 * will find. Rendering a wallet state before hydration would produce markup the
 * server could not have produced — a mismatch, and worse, a moment where the UI
 * asserts something about the user's wallet that is not yet true.
 *
 * Implemented with `useSyncExternalStore` rather than a mount effect: it
 * returns the server snapshot during SSR and the client snapshot afterwards,
 * with no state update and no extra render pass.
 *
 * Consumers render a neutral placeholder of identical dimensions until this
 * returns true, so there is no layout shift either.
 */

/** Nothing to subscribe to — the value changes exactly once, at hydration. */
const subscribe = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

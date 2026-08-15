"use client";

import { useEffect, useState } from "react";

/**
 * A ticking clock for elapsed times and staleness derivation.
 *
 * Time is injected into every timeline calculation rather than read inside it,
 * which is what makes the staleness and ETA logic pure and testable. This hook
 * is the single place the real clock enters the UI.
 *
 * The interval stops when `enabled` is false — a completed transfer has no
 * elapsed time left to count, and a timer that keeps running on a terminal
 * state is wasted work.
 */
export function useNow(intervalMs = 1_000, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      setNow(new Date());
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, enabled]);

  return now;
}

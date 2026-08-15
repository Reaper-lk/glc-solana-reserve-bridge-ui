/**
 * Time and duration formatting (design spec A5 / A13).
 *
 * Two rules from the design review are implemented here:
 *   - Absolute times are always UTC and always labelled. An unlabelled local
 *     time in a receipt is ambiguous, and ambiguity in a financial record is a
 *     support ticket.
 *   - An ETA is a range with a typical case, and degrades to "Estimating…"
 *     rather than inventing precision. A countdown never reaches zero and sits
 *     there; the caller transitions the step to `slow` instead.
 */

export function formatUtcTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

export function formatUtcDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} UTC`;
}

/**
 * Compact duration: `47m 12s`, `2h 14m`, `3d 4h`.
 * Always two units at most — more precision than that is noise.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/** Relative time, past or future: `23m ago`, `in 4m`, `just now`. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const deltaSeconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (Math.abs(deltaSeconds) < 5) return "just now";

  const magnitude = formatDuration(Math.abs(deltaSeconds));
  return deltaSeconds > 0 ? `${magnitude} ago` : `in ${magnitude}`;
}

export interface EtaRange {
  /** Best estimate, in seconds. */
  readonly typicalSeconds: number;
  /** Lower and upper bounds observed for this step, in seconds. */
  readonly lowSeconds: number;
  readonly highSeconds: number;
}

/**
 * Render an ETA as "~16 min remaining (typically 12-28 min)".
 *
 * Returns "Estimating…" when the inputs are not coherent enough to state a
 * number honestly, which is the required degradation rather than a guess.
 */
export function formatEta(range: EtaRange | null | undefined): string {
  if (!range) return "Estimating…";

  const { typicalSeconds, lowSeconds, highSeconds } = range;
  const valid =
    Number.isFinite(typicalSeconds) &&
    Number.isFinite(lowSeconds) &&
    Number.isFinite(highSeconds) &&
    lowSeconds >= 0 &&
    highSeconds >= lowSeconds;

  if (!valid) return "Estimating…";
  if (typicalSeconds <= 0) return "Any moment now";

  const spread = highSeconds - lowSeconds;
  // A range wider than the estimate itself is not information, it is noise.
  if (spread > typicalSeconds * 3) return "Estimating…";

  return `~${formatDuration(typicalSeconds)} remaining (typically ${formatDuration(
    lowSeconds,
  )}–${formatDuration(highSeconds)})`;
}

/** Elapsed seconds between an ISO timestamp and now. Never negative. */
export function elapsedSeconds(iso: string, now: Date = new Date()): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
}

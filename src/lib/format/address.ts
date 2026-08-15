/**
 * Address and hash presentation (design spec E3 / A8).
 *
 * Addresses are chunked in groups of four so a human can actually compare them,
 * which is how clipboard-hijacking malware gets caught. Middle-truncation is
 * available for dense contexts such as table rows, but is never used in a
 * confirmation context — the review screen shows the whole address.
 */

const DEFAULT_CHUNK_SIZE = 4;

/** Split an address into fixed-size groups for visual verification. */
export function chunkAddress(address: string, size = DEFAULT_CHUNK_SIZE): string[] {
  if (size < 1) throw new Error("Chunk size must be at least 1");
  const clean = address.trim();
  if (clean.length === 0) return [];

  const chunks: string[] = [];
  for (let index = 0; index < clean.length; index += size) {
    chunks.push(clean.slice(index, index + size));
  }
  return chunks;
}

/**
 * Middle-truncate for dense display, e.g. `Gd7x9a…k9c0f9`.
 *
 * Returns the address unchanged when truncating would not actually shorten it,
 * so short identifiers are never decorated with a misleading ellipsis.
 */
export function truncateMiddle(value: string, lead = 6, tail = 4): string {
  const clean = value.trim();
  if (lead < 1 || tail < 1) throw new Error("lead and tail must be positive");
  if (clean.length <= lead + tail + 1) return clean;
  return `${clean.slice(0, lead)}…${clean.slice(-tail)}`;
}

/** Short form for a transfer id or transaction hash in a table row. */
export function shortId(value: string, length = 4): string {
  const clean = value.trim();
  return clean.length <= length ? clean : `${clean.slice(0, length)}…`;
}

/**
 * Whether the first and last chunks match between two addresses. Used to hint
 * at a clipboard swap, where the middle differs but the ends look familiar.
 */
export function hasMatchingEnds(
  a: string,
  b: string,
  size = DEFAULT_CHUNK_SIZE,
): boolean {
  if (a.length < size * 2 || b.length < size * 2) return a === b;
  return a.slice(0, size) === b.slice(0, size) && a.slice(-size) === b.slice(-size);
}

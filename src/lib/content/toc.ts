/**
 * Table of contents for the long-form pages (design spec F11).
 *
 * Slugs are derived from headings rather than authored separately, so a
 * heading and its anchor cannot drift apart — a glossary link pointing at an
 * anchor that no longer exists silently scrolls nowhere, and the reader
 * concludes the term was never defined.
 */

export interface ContentSection {
  readonly title: string;
  readonly id: string;
}

/**
 * URL-safe anchor from a heading.
 *
 * Diacritics are folded, punctuation dropped, spaces hyphenated. Deliberately
 * conservative: an anchor containing anything that needs encoding is an anchor
 * that breaks when pasted into a chat client.
 */
export function slugify(heading: string): string {
  return heading
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the section list, guaranteeing unique ids.
 *
 * Two headings that slugify identically would produce duplicate DOM ids, and
 * the second anchor would be unreachable. The collision is suffixed rather
 * than dropped so both sections stay linkable.
 */
export function buildToc(titles: readonly string[]): readonly ContentSection[] {
  const seen = new Map<string, number>();

  return titles.map((title) => {
    const base = slugify(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    return { title, id: count === 0 ? base : `${base}-${count + 1}` };
  });
}

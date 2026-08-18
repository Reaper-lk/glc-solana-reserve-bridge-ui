import type { ReactNode } from "react";
import { buildToc } from "@/lib/content/toc";
import { cn } from "@/lib/utils/cn";

/**
 * Long-form page layout (design spec F11).
 *
 * A sticky table of contents beside the prose on desktop, collapsing to a
 * native `<details>` disclosure below `md`. `<details>` rather than a custom
 * component: it is keyboard-operable, announced correctly, and works before
 * hydration — on a reference page that people reach mid-problem, that last
 * property is worth more than a matching animation.
 *
 * The measure is capped by `--container-prose` (680px), which is the 68–72
 * character line the design asks for at our body size.
 */
export function ContentPage({
  title,
  intro,
  sections,
  children,
}: {
  title: string;
  intro?: string;
  /** Section headings, in document order. Ids are derived from them. */
  sections: readonly string[];
  children: ReactNode;
}) {
  const toc = buildToc(sections);

  return (
    <div className="max-w-page mx-auto w-full px-4 py-8 md:px-6 md:py-12">
      <header className="max-w-prose">
        <h1 className="text-display-lg text-ink-950">{title}</h1>
        {intro && <p className="text-body-lg text-ink-600 mt-3">{intro}</p>}
      </header>

      <div className="mt-8 gap-10 md:flex md:items-start">
        <nav aria-label="On this page" className="md:sticky md:top-8 md:w-56 md:shrink-0">
          <details className="border-ink-200 rounded-md border md:border-0" open={false}>
            <summary className="text-body-sm text-ink-700 cursor-pointer px-4 py-3 md:hidden">
              Contents
            </summary>
            <TocList toc={toc} className="px-4 pb-3 md:px-0 md:pb-0" />
          </details>
          {/* Always expanded at md and above; the disclosure above is hidden. */}
          <div className="hidden md:block">
            <p className="text-overline text-ink-500 uppercase">On this page</p>
            <TocList toc={toc} className="mt-2" />
          </div>
        </nav>

        <div className="max-w-prose min-w-0 flex-1 space-y-10">{children}</div>
      </div>
    </div>
  );
}

function TocList({
  toc,
  className,
}: {
  toc: readonly { title: string; id: string }[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-1.5", className)}>
      {toc.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="text-body-sm text-ink-600 hover:text-ink-950 underline-offset-2 hover:underline"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * One section, with the anchor its table-of-contents entry points at.
 *
 * `scroll-mt` keeps the heading clear of the sticky chrome when jumped to —
 * without it the anchor lands with the heading hidden behind the header, which
 * reads as a broken link.
 */
export function ContentSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-heading-1 text-ink-950">{title}</h2>
      <div className="text-body text-ink-700 mt-3 space-y-3">{children}</div>
    </section>
  );
}

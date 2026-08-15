import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { footerNav } from "./navigation";
import { externalLinks, primaryDomain } from "@/lib/config/links";
import { Container } from "@/components/ui/Container";

/**
 * Global footer (design spec G2).
 *
 * Two things earn their place here. The official-domain notice appears on every
 * page because more bridge users lose money to a convincing fake frontend than
 * to a protocol bug (design spec A9). And the protocol repo, audits and bug
 * bounty are linked from every page, because open source is a trust asset only
 * if it is findable (design spec B8).
 *
 * Outbound links render only when configured. Nothing here is hardcoded.
 */
export function Footer() {
  const external = [
    { label: "Protocol repository", href: externalLinks.protocolRepo },
    { label: "Documentation", href: externalLinks.docs },
    { label: "Audits", href: externalLinks.audits },
    { label: "Bug bounty", href: externalLinks.bugBounty },
  ].filter((item): item is { label: string; href: string } => Boolean(item.href));

  return (
    <footer className="border-ink-200 bg-ink-50 mt-16 border-t">
      <Container className="py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {footerNav.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              <h2 className="text-overline text-ink-500 uppercase">{group.heading}</h2>
              <ul className="mt-3 space-y-2">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-body-sm text-ink-700 hover:text-ink-950"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {external.length > 0 && (
          <nav aria-label="Developers" className="border-ink-200 mt-8 border-t pt-6">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {external.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-body-sm text-ink-700 hover:text-ink-950"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <p className="border-ink-200 text-body-sm text-warn-700 mt-8 flex items-start gap-2 border-t pt-6">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
            strokeWidth={2}
          />
          <span>
            Official domain:{" "}
            <span className="font-mono font-semibold">{primaryDomain()}</span> — always
            verify the address in your browser before connecting a wallet. We will never
            ask for your seed phrase.
          </span>
        </p>
      </Container>
    </footer>
  );
}

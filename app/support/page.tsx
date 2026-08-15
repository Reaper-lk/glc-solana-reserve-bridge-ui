import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { externalLinks } from "@/lib/config/links";

export const metadata: Metadata = { title: "Support" };

export default function SupportPage() {
  return (
    <Container size="prose" className="py-8 md:py-12">
      <h1 className="text-heading-1">Support</h1>
      <p className="text-body text-ink-700 mt-3">
        Include the transfer id from a transfer&apos;s own page — it is enough for support
        to look up its exact state on the backend.
      </p>
      {externalLinks.support && (
        <a
          href={externalLinks.support}
          className="text-body mt-4 inline-block underline underline-offset-2"
        >
          Contact support
        </a>
      )}
    </Container>
  );
}

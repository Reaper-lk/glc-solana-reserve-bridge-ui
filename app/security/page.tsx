import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "Security" };

const SECTIONS = [
  "Reserve-backed, not synthetic",
  "What the frontend never does",
  "What can go wrong",
];

export default function SecurityPage() {
  return (
    <ContentPage
      title="Security model"
      intro="This bridge is reserve-backed: it releases existing GLC from pre-funded reserves rather than creating new tokens. Understanding that distinction is the fastest way to understand what can and cannot go wrong."
      sections={SECTIONS}
    >
      <ContentSection
        id="reserve-backed-not-synthetic"
        title="Reserve-backed, not synthetic"
      >
        <p>
          The bridge never creates a synthetic derivative of GLC, and it never changes
          GLC&apos;s total supply on either network. A transfer works by verifying a
          deposit on the source network, then releasing existing GLC from the destination
          network&apos;s reserve. If a reserve does not have enough capacity, the transfer
          is refused rather than accepted.
        </p>
      </ContentSection>
      <ContentSection
        id="what-the-frontend-never-does"
        title="What the frontend never does"
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>Request or store a private key.</li>
          <li>Perform a custody operation, or authorize a reserve release itself.</li>
          <li>
            Calculate an authoritative fee, quote, or settlement amount — the backend
            does.
          </li>
          <li>Bypass a reserve or pause check reported by the backend.</li>
          <li>Represent an unknown or failed transfer as successful.</li>
        </ul>
      </ContentSection>
      <ContentSection id="what-can-go-wrong" title="What can go wrong">
        <p>
          A direction can be paused, or a destination reserve can run out of available
          capacity — both are shown plainly on the bridge form and the{" "}
          <a href="/status" className="underline underline-offset-2">
            status page
          </a>
          . A transfer can also land in manual review, or fail outright; every state is
          visible on that transfer&apos;s detail page, with what it means for your funds
          and what to do next.
        </p>
      </ContentSection>
    </ContentPage>
  );
}

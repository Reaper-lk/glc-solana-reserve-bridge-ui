import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "FAQ" };

const SECTIONS = [
  "Does the bridge create new GLC?",
  "What is the fee?",
  "Why was my transfer refused?",
  "My transfer has been pending a while — is it lost?",
];

export default function FaqPage() {
  return (
    <ContentPage title="Frequently asked questions" sections={SECTIONS}>
      <ContentSection
        id="does-the-bridge-create-new-glc"
        title="Does the bridge create new GLC?"
      >
        <p>
          No. This bridge never creates new GLC or changes its supply. A transfer releases
          existing GLC from a pre-funded reserve on the destination network after
          verifying your deposit on the source network.
        </p>
      </ContentSection>
      <ContentSection id="what-is-the-fee" title="What is the fee?">
        <p>
          A flat 3% of the gross amount, computed by the bridge backend on every quote and
          transfer.
        </p>
      </ContentSection>
      <ContentSection
        id="why-was-my-transfer-refused"
        title="Why was my transfer refused?"
      >
        <p>
          The most common reasons are an amount outside the published minimum/maximum, the
          destination direction being paused, or the destination reserve not having enough
          available capacity right now. The bridge form states which one applies before
          you submit.
        </p>
      </ContentSection>
      <ContentSection
        id="my-transfer-has-been-pending-a-while-is-it-lost"
        title="My transfer has been pending a while — is it lost?"
      >
        <p>
          Open the transfer&apos;s own page for its current state and what it means for
          your funds. A transfer under manual review or awaiting confirmations is not lost
          — check back, or contact support with the transfer id.
        </p>
      </ContentSection>
    </ContentPage>
  );
}

import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "Glossary" };

const TERMS: readonly { term: string; definition: string }[] = [
  {
    term: "Reserve",
    definition:
      "GLC held on a network, pre-funded, that a transfer's payout is released from.",
  },
  {
    term: "Available capacity",
    definition:
      "How much a reserve can currently pay out. Never unlimited, and can reach zero.",
  },
  {
    term: "Bridge fee",
    definition:
      "A flat 3% of the gross amount, charged on every transfer. Network fees are separate.",
  },
  { term: "Gross amount", definition: "What you bridge, before the fee." },
  { term: "Net amount", definition: "What the destination receives, after the fee." },
  {
    term: "Deposit",
    definition: "Sending funds into the bridge's control on the source network.",
  },
  {
    term: "Settlement",
    definition: "The point a transfer's destination payout is released.",
  },
  {
    term: "Paused",
    definition: "A direction the bridge operator has temporarily disabled.",
  },
  {
    term: "Insufficient liquidity",
    definition:
      "A destination reserve does not have enough available capacity for the requested amount.",
  },
  {
    term: "Manual review",
    definition:
      "A transfer routed to an operator for resolution instead of proceeding automatically.",
  },
];

const SECTIONS = TERMS.map((entry) => entry.term);

export default function GlossaryPage() {
  return (
    <ContentPage title="Glossary" sections={SECTIONS}>
      {TERMS.map((entry) => (
        <ContentSection
          key={entry.term}
          id={entry.term.toLowerCase().replace(/\s+/g, "-")}
          title={entry.term}
        >
          <p>{entry.definition}</p>
        </ContentSection>
      ))}
    </ContentPage>
  );
}

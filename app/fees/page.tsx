import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "Fees & limits" };

const SECTIONS = ["Bridge fee", "Transfer limits", "Reserve capacity"];

export default function FeesPage() {
  return (
    <ContentPage
      title="Fees & limits"
      intro="The bridge charges a flat 6% service fee. Minimums, maximums, and reserve capacity are set by the bridge backend and can change without notice — the figures shown on the bridge form at the time you request a quote are always authoritative."
      sections={SECTIONS}
    >
      <ContentSection id="bridge-fee" title="Bridge fee">
        <p>
          Every transfer, in either direction, is charged a 6% fee on the gross amount.
          For example, bridging 1,000 GLC charges a 60 GLC fee and releases 940 GLC to the
          destination.
        </p>
        <p>
          The fee is computed once, server-side, from the gross amount you request — the
          bridge form only displays what the backend&apos;s quote returns, it never
          computes a fee itself.
        </p>
      </ContentSection>
      <ContentSection id="transfer-limits" title="Transfer limits">
        <p>
          Every transfer has a minimum and maximum size, published by the bridge backend
          and shown on the bridge form. Attempting an amount outside these bounds is
          rejected before any funds move.
        </p>
      </ContentSection>
      <ContentSection id="reserve-capacity" title="Reserve capacity">
        <p>
          This bridge never creates new GLC or changes its supply — every transfer is paid
          out from existing GLC held in a pre-funded reserve on the destination network.
          If a direction&apos;s reserve does not currently have enough capacity for your
          amount, the transfer is refused rather than accepted and left unable to settle.
          See{" "}
          <a href="/reserves" className="underline underline-offset-2">
            reserve capacity
          </a>{" "}
          for live figures.
        </p>
      </ContentSection>
    </ContentPage>
  );
}

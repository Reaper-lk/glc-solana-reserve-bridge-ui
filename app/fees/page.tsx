import type { Metadata } from "next";
import { ContentPage, ContentSection } from "@/components/content/ContentPage";

export const metadata: Metadata = { title: "Fees & limits" };

const SECTIONS = ["Bridge fee", "Transfer limits", "Reserve capacity"];

export default function FeesPage() {
  return (
    <ContentPage
      title="Fees & limits"
      intro="Bridge fees are route-specific and are shown before you confirm a transfer. Minimums, maximums, and reserve capacity are set by the bridge backend and can change without notice — the figures shown on the bridge form at the time you request a quote are always authoritative."
      sections={SECTIONS}
    >
      <ContentSection id="bridge-fee" title="Bridge fee">
        <p>
          Bridge fees are route-specific and are shown before you confirm a transfer. The
          rate depends on the route, so this page does not publish one — the quote you are
          shown on the bridge form states the fee charged on the gross amount and the net
          amount the destination receives. Network fees are separate.
        </p>
        <p>
          The fee is computed once, server-side, from the gross amount you request — the
          bridge form only displays what the backend&apos;s quote returns, it never
          computes a fee itself.
        </p>
      </ContentSection>
      <ContentSection id="transfer-limits" title="Transfer limits">
        <p>
          Max per transfer: 20,000 GLC. Every transfer has a minimum and maximum size,
          published by the bridge backend and shown on the bridge form — the live figures
          there are always authoritative. Attempting an amount outside these bounds is
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

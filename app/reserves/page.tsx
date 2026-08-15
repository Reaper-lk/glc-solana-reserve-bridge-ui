import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { ReservesView } from "@/features/reserves/ReservesView";

export const metadata: Metadata = { title: "Reserves" };

export default function ReservesPage() {
  return (
    <Container className="flex flex-col gap-6 py-8 md:py-12">
      <div>
        <h1 className="text-heading-1">Reserves</h1>
        <p className="text-body-sm text-ink-600 mt-1">
          This bridge never creates new GLC or changes its supply. Every transfer is
          fulfilled from existing GLC held in pre-funded reserves on each network, so
          capacity — not issuance — is what limits how much can move.
        </p>
      </div>
      <ReservesView />
    </Container>
  );
}

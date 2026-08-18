import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { VerifyView } from "@/features/verify/VerifyView";

export const metadata: Metadata = { title: "Verify" };

export default function VerifyPage() {
  return (
    <Container size="prose" className="flex flex-col gap-6 py-8 md:py-12">
      <div>
        <h1 className="text-heading-1">Verify</h1>
        <p className="text-body-sm text-ink-600 mt-1">
          Check an address or domain you were given elsewhere against what the bridge
          itself publishes.
        </p>
      </div>
      <VerifyView />
    </Container>
  );
}

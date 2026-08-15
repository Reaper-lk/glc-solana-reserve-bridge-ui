import type { Metadata } from "next";
import { Container } from "@/components/ui";

export const metadata: Metadata = { title: "Paused" };

export default function PausedPage() {
  return (
    <Container size="prose" className="py-8 md:py-12">
      <h1 className="text-heading-1">What does &quot;paused&quot; mean?</h1>
      <p className="text-body text-ink-700 mt-3">
        A paused direction has been temporarily disabled by the bridge operator. New
        transfers in that direction are refused before any funds move. Funds already in
        flight in that direction are not affected by a pause — they continue toward
        settlement.
      </p>
      <p className="text-body text-ink-700 mt-3">
        A pause is distinct from insufficient liquidity: a direction can be unpaused but
        still unable to accept a transfer if its destination reserve does not currently
        have enough available capacity. Both states are shown plainly on the bridge form.
      </p>
    </Container>
  );
}

import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { BridgeCard } from "@/features/bridge/BridgeCard";

export const metadata: Metadata = { title: "Bridge" };

export default function BridgePage() {
  return (
    <Container size="card" className="py-8 md:py-12">
      <BridgeCard />
    </Container>
  );
}

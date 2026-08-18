import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { ExplorerFeed } from "@/features/explorer/ExplorerFeed";

export const metadata: Metadata = { title: "Explorer" };

export default function ExplorerPage() {
  return (
    <Container className="flex flex-col gap-6 py-8 md:py-12">
      <div>
        <h1 className="text-heading-1">Explorer</h1>
        <p className="text-body-sm text-ink-600 mt-1">
          Every real state transition the bridge has recorded. No wallet needed, and no
          counterparty address or operator identity is ever shown here.
        </p>
      </div>
      <BridgeOverviewStats />
      <ExplorerFeed />
    </Container>
  );
}

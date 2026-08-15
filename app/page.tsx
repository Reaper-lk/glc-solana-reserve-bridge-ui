import Link from "next/link";
import { Container } from "@/components/ui";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { routes } from "@/lib/config/links";

export default function HomePage() {
  return (
    <Container className="flex flex-col gap-10 py-12 md:py-20">
      <div className="max-w-prose">
        <h1 className="text-display-lg text-ink-950">
          Native GLC. Existing reserves. Two networks. One bridge.
        </h1>
        <p className="text-body-lg text-ink-600 mt-4">
          Move existing GLC between the Goldcoin blockchain and Solana. This bridge does
          not create new GLC or change its supply — every transfer is fulfilled from
          pre-funded reserves and a 1% bridge fee applies. The bridge backend is the sole
          source of truth for quotes, limits, and reserve capacity.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href={routes.bridge}
            className="bg-ink-950 text-body rounded-lg px-5 py-3 font-medium text-white"
          >
            Open the bridge
          </Link>
          <Link
            href={routes.explorer}
            className="border-ink-300 text-body text-ink-900 rounded-lg border px-5 py-3 font-medium"
          >
            View the explorer
          </Link>
        </div>
      </div>

      <BridgeOverviewStats />
    </Container>
  );
}

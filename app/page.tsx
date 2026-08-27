import { ArrowRight, CircleCheck } from "lucide-react";
import { ButtonLink, Card, ChainBadge, Container } from "@/components/ui";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { routes } from "@/lib/config/links";
import { directions } from "@/lib/bridge";

const TRUST_POINTS = [
  "No new GLC is ever created.",
  "No GLC is wrapped into a substitute token.",
  "Every transfer is fulfilled from existing, pre-funded reserves.",
  "A flat 6% bridge fee applies, computed by the bridge backend.",
] as const;

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Container className="flex flex-col gap-12 py-12 md:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="max-w-prose">
            <p className="text-overline text-gold-700 uppercase">Reserve-backed bridge</p>
            <h1 className="text-display-xl text-ink-950 mt-2">
              Native GLC. Existing reserves.
              <br />
              Two networks. One bridge.
            </h1>
            <p className="text-body-lg text-ink-600 mt-4">
              Move existing GLC between the Goldcoin blockchain and Solana. This is not a
              wrapped-token bridge — it releases GLC that is already held in reserve on
              the destination network, so supply never changes on either side.
            </p>

            <ul className="mt-6 flex flex-col gap-2">
              {TRUST_POINTS.map((point) => (
                <li key={point} className="text-body text-ink-700 flex items-start gap-2">
                  <CircleCheck
                    aria-hidden="true"
                    className="text-success-500 mt-0.5 size-4 shrink-0"
                  />
                  {point}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={routes.bridge} variant="brand" size="lg">
                Bridge GLC
                <ArrowRight aria-hidden="true" className="size-4" />
              </ButtonLink>
              <ButtonLink href={routes.explorer} variant="secondary" size="lg">
                View the explorer
              </ButtonLink>
              <ButtonLink href={routes.reserves} variant="tertiary" size="lg">
                View reserves
              </ButtonLink>
            </div>
          </div>

          <NetworkDiagram />
        </div>

        <div>
          <h2 className="text-overline text-ink-500 mb-3 uppercase">Bridge activity</h2>
          <BridgeOverviewStats />
        </div>
      </Container>
    </div>
  );
}

/**
 * The two networks and the reserve sitting between them — a picture of the
 * architecture, not a technical diagram. Deliberately static (no motion):
 * this is the one place a reader forms their mental model of the whole
 * product, and that deserves stillness, not a flourish.
 */
function NetworkDiagram() {
  return (
    <Card variant="raised" padding="lg" className="mx-auto w-full max-w-sm">
      <div className="flex flex-col items-center gap-3">
        <NetworkNode chain="goldcoin" label={directions.SolToGlc.to.token.name} />

        <div className="text-ink-300 flex flex-col items-center py-1">
          <div className="border-ink-200 h-6 border-l" />
          <p className="text-body-sm text-ink-500 px-2">reserve-backed</p>
          <div className="border-ink-200 h-6 border-l" />
        </div>

        <NetworkNode chain="solana" label={directions.GlcToSol.to.token.name} />
      </div>

      <p className="text-body-sm text-ink-500 mt-5 text-center">
        The same GLC, held in reserve on each network — never minted, never wrapped.
      </p>
    </Card>
  );
}

function NetworkNode({ chain, label }: { chain: "goldcoin" | "solana"; label: string }) {
  return (
    <div className="border-ink-200 bg-ink-50 flex w-full items-center justify-between rounded-lg border px-4 py-3">
      <div>
        <p className="text-heading-3 text-ink-950">{label}</p>
        <ChainBadge chain={chain} className="mt-0.5" />
      </div>
    </div>
  );
}

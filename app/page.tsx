import { ArrowRight, CircleCheck } from "lucide-react";
import { ButtonLink, Card, Container } from "@/components/ui";
import { BridgeOverviewStats } from "@/features/explorer/BridgeOverviewStats";
import { routes } from "@/lib/config/links";
import { CHAIN_DESCRIPTORS } from "@/lib/bridge";
import { cn } from "@/lib/utils/cn";

const TRUST_POINTS = [
  "No new GLC is ever created.",
  "No GLC is wrapped into a substitute token.",
  "Every transfer is fulfilled from existing, pre-funded reserves.",
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
              Many networks. One bridge.
            </h1>
            <p className="text-body-lg text-ink-600 mt-4">
              Move existing GLC between the Goldcoin blockchain and other rails. This is
              not a wrapped-token bridge — it releases GLC that is already held in reserve
              on the destination network, so supply never changes on either side.
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
 * The supported networks and the reserve they all draw from — a picture of
 * the architecture, not a technical diagram. Deliberately static (no
 * motion): this is the one place a reader forms their mental model of the
 * whole product, and that deserves stillness, not a flourish.
 *
 * The network tiles are read from `CHAIN_DESCRIPTORS`, so a network added to
 * the registry appears here with no edit to this file — the scalability the
 * registry documents as its whole purpose. The grid is what makes that safe:
 * it reflows at any count, where the previous two-node column could only ever
 * describe exactly two networks.
 */
function NetworkDiagram() {
  return (
    <Card variant="raised" padding="lg" className="mx-auto w-full max-w-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CHAIN_DESCRIPTORS.map((chain) => (
          <NetworkTile
            key={chain.id}
            token={chain.token.name}
            network={chain.name}
            markClassName={chain.markClassName}
          />
        ))}
        {/*
         * The open-ended slot. Dashed and muted so it reads as a placeholder
         * rather than a fourth network you could pick today, and so no real
         * network — Robinhood included — is styled as the special one.
         */}
        <NetworkTile token="More networks" network="Coming next" placeholder />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className="border-ink-200 h-px flex-1 border-t" />
        <p className="text-body-sm text-ink-500">reserve-backed</p>
        <span className="border-ink-200 h-px flex-1 border-t" />
      </div>

      <p className="text-body-sm text-ink-500 mt-4 text-center">
        The same GLC across supported networks — pre-funded, reserve-backed, never
        wrapped.
      </p>
    </Card>
  );
}

/**
 * One network in the grid: the token as it exists there, then the network
 * itself behind its identity mark.
 *
 * The mark repeats `ChainBadge`'s diamond and colour rather than reusing the
 * component, because the badge hardcodes its own label set and this tile must
 * name each network the way the registry does.
 */
function NetworkTile({
  token,
  network,
  markClassName,
  placeholder = false,
}: {
  token: string;
  network: string;
  markClassName?: string;
  placeholder?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        placeholder ? "border-ink-200 border-dashed" : "border-ink-200 bg-ink-50",
      )}
    >
      <p
        className={cn(
          "text-body-sm font-medium",
          placeholder ? "text-ink-500" : "text-ink-950",
        )}
      >
        {token}
      </p>
      <p className="text-label text-ink-700 mt-0.5 flex items-center gap-1.5 font-medium">
        <span aria-hidden="true" className={markClassName ?? "text-ink-300"}>
          ◆
        </span>
        {network}
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { CircleX } from "lucide-react";
import { routes } from "@/lib/config/links";
import { useChains, useReserve } from "@/lib/query/hooks";
import {
  destinationReserveGroups,
  displayDescriptorFor,
  executableRoutes,
} from "@/lib/bridge";
import type { DestinationReserve } from "@/lib/bridge";
import { toBigInt } from "@/lib/api/schemas/common";

/**
 * The insufficient-liquidity banner.
 *
 * Site-wide and not dismissible: a reserve with no remaining capacity is
 * the single most important thing to tell someone, on whatever page they
 * happen to be reading, and letting them close it would be letting them
 * close the only warning that matters.
 *
 * Renders NOTHING in every other case — including while loading and on
 * error. A liquidity warning that flickered on during a slow fetch would be
 * a false alarm, and false alarms are how real ones get ignored.
 *
 * # Why it names routes rather than "sides"
 *
 * It used to say "Both reserves are out of available capacity." That
 * sentence counted the two reserves `GET /reserve` publishes, in a bridge
 * that now settles onto three — and it left a reader to work out which of
 * their transfers was affected. The routes each exhausted reserve pays out
 * of are read from `GET /chains`, so a route the backend opens later is
 * named here with no frontend deploy.
 *
 * The Robinhood reserve is deliberately absent from this banner: its
 * capacity lives on `GET /robinhood/reserve`, which this strip does not
 * fetch (a deployment without the route answers 404 on every page load).
 * /status reports that reserve's own capacity on the `GlcToRhn` card.
 */
export function ReserveBanner() {
  const reserve = useReserve();
  const chains = useChains();
  const data = reserve.data;

  if (!data) return null;

  // Exact atomic strings compared as bigints — see `atomicAmountSchema`.
  const exhausted: DestinationReserve[] = [];
  if (toBigInt(data.goldcoin_available_capacity) <= 0n) exhausted.push("goldcoin");
  if (toBigInt(data.solana_available_capacity) <= 0n) exhausted.push("solana");

  if (exhausted.length === 0) return null;

  // Every executable route that pays out of an exhausted reserve, named
  // from the registry rather than from a local list of "the routes we know
  // about". Empty while `/chains` is still in flight, in which case the
  // banner states the reserve alone rather than guessing at its routes.
  const groups = destinationReserveGroups(executableRoutes(chains.data));
  const affected = groups
    .filter((group) => exhausted.includes(group.reserve))
    .flatMap((group) => group.routes.map((route) => route.label));

  const reserveNames = exhausted
    .map((reserve) => displayDescriptorFor(reserve).name)
    .join(" and ");
  const sentence =
    exhausted.length === 1
      ? `The ${reserveNames} reserve is out of available capacity.`
      : `The ${reserveNames} reserves are out of available capacity.`;

  return (
    // Literal white on the danger fill, in both themes — see Button's
    // `danger` variant for why this one does not follow the ink scale.
    <div role="alert" className="bg-danger-500 text-white">
      <div className="max-w-page mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6">
        <CircleX aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        <p className="text-body-sm">
          {sentence}{" "}
          {affected.length > 0
            ? `New transfers cannot be completed right now on ${affected.join(", ")}.`
            : "New transfers that settle there cannot be completed right now."}
        </p>
        <Link
          href={routes.reserves}
          className="text-body-sm ml-auto shrink-0 underline underline-offset-2"
        >
          See the figures
        </Link>
      </div>
    </div>
  );
}

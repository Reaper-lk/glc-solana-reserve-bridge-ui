"use client";

import Link from "next/link";
import { CircleX } from "lucide-react";
import { routes } from "@/lib/config/links";
import { useReserve } from "@/lib/query/hooks";
import { directions } from "@/lib/bridge";
import { toBigInt } from "@/lib/api/schemas/common";

/**
 * The insufficient-liquidity banner.
 *
 * Site-wide and not dismissible: a direction with no remaining reserve
 * capacity is the single most important thing to tell someone, on whatever
 * page they happen to be reading, and letting them close it would be
 * letting them close the only warning that matters.
 *
 * Renders NOTHING in every other case — including while loading and on
 * error. A liquidity warning that flickered on during a slow fetch would be
 * a false alarm, and false alarms are how real ones get ignored.
 */
export function ReserveBanner() {
  const reserve = useReserve();
  const data = reserve.data;

  if (!data) return null;

  // Exact atomic strings compared as bigints — see `atomicAmountSchema`.
  const goldcoinShort = toBigInt(data.goldcoin_available_capacity) <= 0n;
  const solanaShort = toBigInt(data.solana_available_capacity) <= 0n;

  if (!goldcoinShort && !solanaShort) return null;

  const which =
    goldcoinShort && solanaShort
      ? "Both reserves are out of available capacity."
      : goldcoinShort
        ? `The Goldcoin reserve is out of available capacity — ${directions.SolToGlc.label} is affected.`
        : `The Solana reserve is out of available capacity — ${directions.GlcToSol.label} is affected.`;

  return (
    <div role="alert" className="bg-danger-500 text-white">
      <div className="max-w-page mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6">
        <CircleX aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
        <p className="text-body-sm">
          {which} New transfers on that side cannot be completed right now.
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

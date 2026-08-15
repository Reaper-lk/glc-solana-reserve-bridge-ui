"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { TokenAmount } from "@/components/ui/TokenAmount";
import { isTokenBalanceAvailable, useSolBalance, useTokenBalance } from "@/lib/solana";
import { cn } from "@/lib/utils/cn";

/**
 * Connected wallet balances (design spec C3 / G3).
 *
 * Three states are kept strictly distinct, because conflating them on a screen
 * where someone is deciding how much to bridge is a real risk:
 *
 *   loading      → skeleton
 *   zero         → "0.00 GLC", a real and knowable value
 *   unavailable  → an em dash, when the RPC or mint is not configured, or the
 *                  read failed
 *
 * A balance we could not read is never rendered as zero.
 */
export function WalletBalances({ className }: { className?: string }) {
  const sol = useSolBalance();
  const token = useTokenBalance();
  const tokenConfigured = isTokenBalanceAvailable();

  return (
    <dl className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1", className)}>
      {tokenConfigured && (
        <div className="flex items-baseline gap-1.5">
          <dt className="sr-only">Solana GLC balance</dt>
          <dd className="text-body-sm text-ink-700">
            {token.isPending ? (
              <Skeleton className="h-4 w-20" />
            ) : /* Defensive: the query types narrow `data` to defined here, but a
                   first-load failure has no previous value to fall back on, and a
                   balance we cannot read must never render as zero. */
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            token.isError || !token.data ? (
              <span className="text-ink-500" title="Balance unavailable">
                — GLC
              </span>
            ) : (
              <TokenAmount
                raw={token.data.raw}
                decimals={token.data.decimals}
                symbol={token.data.symbol}
              />
            )}
          </dd>
        </div>
      )}

      <div className="flex items-baseline gap-1.5">
        <dt className="sr-only">Solana balance</dt>
        <dd className="text-body-sm text-ink-700">
          {sol.isPending ? (
            <Skeleton className="h-4 w-16" />
          ) : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          sol.isError || !sol.data ? (
            <span className="text-ink-500" title="Balance unavailable">
              — SOL
            </span>
          ) : (
            <TokenAmount
              raw={sol.data.raw}
              decimals={sol.data.decimals}
              symbol={sol.data.symbol}
              options={{ maxFractionDigits: 4 }}
            />
          )}
        </dd>
      </div>
    </dl>
  );
}

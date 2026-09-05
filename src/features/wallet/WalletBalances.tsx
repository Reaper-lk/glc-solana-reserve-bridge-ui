"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { TokenAmount } from "@/components/ui/TokenAmount";
import { env } from "@/lib/config/env";
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
 *
 * Balances are always read from THIS deployment's configured RPC
 * (`NEXT_PUBLIC_SOLANA_RPC_URL`) and mint — never from any other network. On
 * a non-mainnet cluster that truth is easy to misread: a wallet with real
 * funds on mainnet correctly shows zero here, because localnet/devnet has
 * never seen that address. The cluster label below scopes the figures to the
 * connected network so "0 GLC" can't read as "your wallet is empty". A
 * production deployment configured for `mainnet-beta` and the canonical GLC
 * mint shows the wallet's actual mainnet SOL and GLC balances through these
 * same components, with no label.
 */
const CLUSTER_LABELS: Record<string, string | null> = {
  "mainnet-beta": null,
  devnet: "Devnet",
  testnet: "Testnet",
  localnet: "Localnet",
};

export function WalletBalances({ className }: { className?: string }) {
  const sol = useSolBalance();
  const token = useTokenBalance();
  const tokenConfigured = isTokenBalanceAvailable();
  // `in`-check rather than `??`: mainnet-beta's entry is deliberately null
  // (no label), which a nullish fallback would wrongly resurrect.
  const clusterLabel =
    env.solanaCluster in CLUSTER_LABELS
      ? CLUSTER_LABELS[env.solanaCluster]
      : env.solanaCluster;

  return (
    <dl className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1", className)}>
      {clusterLabel && (
        <div className="flex items-baseline">
          <dt className="sr-only">Balance network</dt>
          <dd
            className="text-body-sm text-ink-500"
            title={`Balances shown are for the connected bridge network (${clusterLabel}), not Solana mainnet.`}
          >
            {clusterLabel}:
          </dd>
        </div>
      )}
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
              /* Exact: this is a spendable balance. A rounded-up balance
                 would offer the holder an amount they cannot send. */
              <TokenAmount
                raw={token.data.raw}
                decimals={token.data.decimals}
                symbol={token.data.symbol}
                precision="exact"
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
              precision="exact"
              options={{ maxFractionDigits: 4 }}
            />
          )}
        </dd>
      </div>
    </dl>
  );
}

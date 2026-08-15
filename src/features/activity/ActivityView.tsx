"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useTransfers } from "@/lib/query/hooks";
import { useWalletConnection } from "@/lib/solana";
import { TransferRow } from "./TransferRow";

/**
 * Wallet-scoped transfer activity.
 *
 * `GET /transfers` only filters by `address` (the recipient for GlcToSol,
 * the depositor for SolToGlc) and `state` — there is no free-text
 * transaction-id search on this backend, so this view does not offer one.
 * The address lives in the URL so a result set is shareable and survives a
 * reload, matching the connected wallet only as a convenience default.
 */
export function ActivityView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wallet = useWalletConnection();

  const urlAddress = searchParams.get("address") ?? "";
  const [draft, setDraft] = useState(urlAddress);

  const address = urlAddress || wallet.address || "";
  // No unscoped fallback: without an address there is nothing to search, and
  // fetching the whole (wallet-scoped-by-design) /transfers list would be
  // both wasteful and semantically wrong for this view.
  const query = useTransfers({ address, limit: 50 }, { enabled: Boolean(address) });

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (draft.trim()) params.set("address", draft.trim());
    else params.delete("address");
    router.replace(`?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={applySearch} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="activity-address" className="sr-only">
          Solana address
        </label>
        <input
          id="activity-address"
          type="text"
          aria-label="Solana address"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Solana address"
          className="border-ink-200 text-body flex-1 rounded-lg border px-3 py-2 font-mono"
        />
        <button
          type="submit"
          className="bg-ink-950 text-body-sm rounded-lg px-4 py-2 font-medium text-white"
        >
          Search
        </button>
      </form>

      {!address && (
        <EmptyState
          icon={History}
          title="No address to search"
          description="Connect a wallet or paste a Solana address to see its bridge transfers."
        />
      )}

      {address && query.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14 w-full" />
          ))}
        </div>
      )}

      {address && query.isError && <ErrorState error={query.error} />}

      {address && query.isSuccess && query.data.items.length === 0 && (
        <EmptyState
          icon={History}
          title="No transfers yet"
          description="Nothing found for this address."
        />
      )}

      {address && query.isSuccess && query.data.items.length > 0 && (
        <div className="border-ink-100 divide-ink-100 divide-y rounded-lg border">
          {query.data.items.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
        </div>
      )}
    </div>
  );
}

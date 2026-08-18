"use client";

import { AddressChunks, Card, ErrorState, Skeleton } from "@/components/ui";
import { useBridgeStatus } from "@/lib/query/hooks";
import { env } from "@/lib/config/env";
import { officialDomains, primaryDomain } from "@/lib/config/links";

/**
 * There is no `/verify` endpoint on the real backend — the ground-truth API
 * inventory found none. Rather than fabricate one, this page states the
 * addresses the bridge itself already publishes through real endpoints
 * (the Goldcoin deposit vault from `GET /status`, the canonical Solana
 * mint from configuration) and the deployment's official domain list.
 */
export function VerifyView() {
  const status = useBridgeStatus();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="text-heading-3 mb-2">Official domains</h2>
        <p className="text-body-sm text-ink-600 mb-3">
          This deployment is served from <strong>{primaryDomain()}</strong>. Anything else
          claiming to be this bridge is not.
        </p>
        <ul className="text-body-sm flex flex-col gap-1 font-mono">
          {officialDomains.map((domain) => (
            <li key={domain}>{domain}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-heading-3 mb-2">Goldcoin deposit vault</h2>
        <p className="text-body-sm text-ink-600 mb-3">
          Read live from the bridge&apos;s own <code>GET /status</code> endpoint — never a
          value this page invents. It changes only if the bridge operator changes it.
        </p>
        {status.isPending && <Skeleton className="h-8 w-full" />}
        {status.isError && <ErrorState error={status.error} />}
        {status.data && <AddressChunks address={status.data.vault_address} />}
      </Card>

      <Card>
        <h2 className="text-heading-3 mb-2">Canonical Solana GLC mint</h2>
        <p className="text-body-sm text-ink-600 mb-3">
          Any other Solana token claiming to be GLC is not this asset.
        </p>
        <AddressChunks address={env.reserveMintAddress} />
      </Card>
    </div>
  );
}

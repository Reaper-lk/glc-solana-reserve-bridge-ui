import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { FundReserveView } from "@/features/admin/FundReserveView";

/**
 * Operator-only Solana reserve funding — deliberately unlinked from every
 * public navigation surface (see `src/components/layout/AppShell.tsx`),
 * and excluded from indexing here as well. This page's own visibility is
 * NOT its access control: production protects `/admin/*` with Nginx Basic
 * Auth at the reverse-proxy layer, entirely outside this repository. Any
 * operator who passes that reaches this page and may connect a wallet to
 * fund the reserve — the connected Phantom wallet itself is still the
 * thing that must sign every transfer (see `useFundReserve`), and the
 * transaction's destination is independently validated regardless of who
 * is operating the page (`assertIsReserveTokenAccount`).
 */
export const metadata: Metadata = {
  title: "Fund reserve",
  robots: { index: false, follow: false },
};

export default function FundReservePage() {
  return (
    <Container size="card" className="flex flex-col gap-6 py-8 md:py-12">
      <h1 className="text-heading-1">Fund the Solana reserve</h1>
      <FundReserveView />
    </Container>
  );
}

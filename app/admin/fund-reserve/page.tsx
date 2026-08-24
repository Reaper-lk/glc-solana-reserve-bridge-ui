import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { FundReserveView } from "@/features/admin/FundReserveView";

/**
 * Operator-only Solana reserve funding — deliberately unlinked from every
 * public navigation surface (see `src/components/layout/AppShell.tsx`),
 * and excluded from indexing here as well. This page's own visibility is
 * NOT its access control: production additionally protects `/admin/*` at
 * the reverse-proxy layer (outside this repository), and the funding
 * action itself is separately gated by the server-side operator allowlist
 * check in `middleware.ts`.
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

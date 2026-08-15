import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { TransferDetail } from "@/features/transfer/TransferDetail";

export const metadata: Metadata = { title: "Transfer · Explorer" };

export default async function ExplorerTransferPage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;
  const id = Number(transferId);
  if (!Number.isInteger(id)) notFound();

  return (
    <Container size="card" className="py-8 md:py-12">
      <TransferDetail id={id} readOnly />
    </Container>
  );
}

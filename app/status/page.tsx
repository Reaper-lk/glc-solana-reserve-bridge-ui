import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { StatusView } from "@/features/status/StatusView";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <Container size="wide" className="flex flex-col gap-6 py-8 md:py-12">
      <h1 className="text-heading-1">Bridge status</h1>
      <StatusView />
    </Container>
  );
}

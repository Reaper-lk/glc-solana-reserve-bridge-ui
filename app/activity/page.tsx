import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui";
import { ActivityView } from "@/features/activity/ActivityView";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <Container className="py-8 md:py-12">
      <h1 className="text-heading-1 mb-6">Activity</h1>
      <Suspense>
        <ActivityView />
      </Suspense>
    </Container>
  );
}

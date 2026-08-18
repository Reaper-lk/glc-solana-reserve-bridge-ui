import { FileQuestion } from "lucide-react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/States";
import { routes } from "@/lib/config/links";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Container className="py-16">
      <EmptyState
        icon={FileQuestion}
        title="We could not find that page"
        description="The link may be out of date. If you were following a transfer, its own page is reachable at /bridge/<id>, or search Activity by the Solana address involved."
        action={
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href={routes.home} variant="primary">
              Go to the bridge
            </ButtonLink>
            <ButtonLink href={routes.activity} variant="secondary">
              Find a transfer
            </ButtonLink>
          </div>
        }
      />
    </Container>
  );
}

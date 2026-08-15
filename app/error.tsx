"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Container } from "@/components/ui/Container";
import { ErrorState } from "@/components/ui/States";
import { routes } from "@/lib/config/links";

/**
 * Page-scope error boundary.
 *
 * Renders through the same three-part formula as every other error in the
 * product: what happened, what it means for the user's funds, what to do next.
 * The raw error is never shown — it is logged for the diagnostic bundle.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error", error);
  }, [error]);

  return (
    <Container size="prose" className="py-16">
      <ErrorState
        error={error}
        actions={
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <ButtonLink href={routes.status} variant="secondary">
              Check bridge status
            </ButtonLink>
          </div>
        }
      />
    </Container>
  );
}

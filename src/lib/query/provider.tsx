"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { isApiError } from "@/lib/api";

/**
 * Server-state provider.
 *
 * Retry policy is deliberate: a validation failure or a 404 is never retried,
 * because repeating a request that cannot succeed only delays telling the user
 * the truth. Transport failures back off and retry twice.
 *
 * Exported (rather than kept private to this module) so the retry predicate
 * and backoff formula have direct unit coverage independent of a mounted
 * provider and a live query cycle.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (failureCount, error) => {
          if (isApiError(error) && !error.retryable) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 8_000),
        refetchOnWindowFocus: true,
        // Live figures stay on screen while a refetch runs (design spec E10).
        placeholderData: <T,>(previous: T) => previous,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

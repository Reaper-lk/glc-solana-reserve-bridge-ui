import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Shared render helper for component tests.
 *
 * A fresh, retry-disabled QueryClient per render: the app's own
 * `createQueryClient` (src/lib/query/provider.tsx) retries retryable
 * failures twice with exponential backoff, which is correct in production
 * but would make every error-path test take several real seconds for no
 * benefit here.
 */
export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });

  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

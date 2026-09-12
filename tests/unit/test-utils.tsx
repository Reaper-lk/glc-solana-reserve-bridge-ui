import { expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import {
  EligibilityEndpointUnpublishedError,
  normalizeRecipientEligibility,
  normalizeRouteWalletEligibility,
  ELIGIBILITY_UNAVAILABLE_TITLE,
} from "@/lib/bridge/eligibility";

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

  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );

  return {
    queryClient,
    ...result,
    /**
     * Re-renders inside the same provider.
     *
     * Testing Library's own `rerender` replaces the whole tree, which would
     * drop the QueryClientProvider this helper added — so a test that
     * re-renders to simulate a wallet or account change would fail with
     * "No QueryClient set" rather than exercising what it meant to.
     */
    rerender: (next: ReactElement) =>
      result.rerender(
        <QueryClientProvider client={queryClient}>{next}</QueryClientProvider>,
      ),
  };
}

/**
 * Picks a network in one of the bridge form's two selectors.
 *
 * The selector is a listbox: a trigger button named for its side, and
 * options named for the network. Tests go through it exactly as a user
 * does — opening it and choosing — rather than reaching for internal
 * state, so a change that breaks the interaction breaks the tests.
 */
export async function selectNetwork(
  user: ReturnType<typeof userEvent.setup>,
  selector: "Source network" | "Destination network",
  networkName: RegExp,
) {
  const trigger = screen.getByRole("button", { name: selector });
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  const listbox = await screen.findByRole("listbox", { name: selector });
  await user.click(within(listbox).getByRole("option", { name: networkName }));
}

/**
 * Waits until `GET /chains` has answered.
 *
 * Every route is unusable before that — unknown availability fails closed
 * — so asserting on availability too early would pass for the wrong
 * reason. The summary leaving its "Checking…" state is the signal that a
 * real verdict has arrived.
 */
export async function waitForRouteVerdict() {
  await waitFor(() => {
    expect(screen.queryByText("Checking…")).not.toBeInTheDocument();
  });
}

/**
 * The form's single primary button.
 *
 * Its LABEL is contextual by design — it states what pressing it would do
 * right now ("Enter an amount", "Connect wallet", "Route unavailable",
 * "Bridge GLC") rather than staying generic, which is also what makes it
 * useful to a screen reader. Tests therefore cannot look it up by one
 * fixed name, and this helper both finds it and pins the vocabulary: a
 * label outside this set is a bug, not a passing test.
 */
export function primaryCta(): HTMLElement {
  // Scoped to the form's own landmark: the FROM panel carries the source
  // network's own connect buttons, and an unscoped lookup could match one
  // of those rather than the form's primary action.
  return within(screen.getByRole("region", { name: "Bridge transfer" })).getByRole(
    "button",
    {
      name: /^(Bridge GLC|Route unavailable|Connect wallet|Enter destination|Enter an amount|Choose networks)$/i,
    },
  );
}

/**
 * Asserts the form accepted everything it validates locally, and is held
 * shut only by the rolling-24h eligibility gate.
 *
 * # Why this is a real assertion and not a weaker `toBeDisabled`
 *
 * `computeGate` is ORDERED: the route, availability, the amount bounds,
 * the canonical-precision check, the destination address and the source
 * wallet's capability are all decided BEFORE eligibility is consulted. So
 * a form reporting the eligibility blocker has necessarily passed every
 * one of those — which is exactly what a test about minimum amounts, or
 * about a quote, means by "accepted".
 *
 * It exists because four of the six routes cannot currently clear
 * eligibility at all: the backend publishes no endpoint for them yet, and
 * every route now requires an authoritative verdict before a wallet may
 * be opened. Tests whose subject is not eligibility assert up to this
 * point rather than asserting an enabled button they can no longer reach.
 */
export async function expectHeldOnlyByEligibility() {
  await waitFor(() => expect(primaryCta()).toBeDisabled());
  expect(screen.getAllByText(ELIGIBILITY_UNAVAILABLE_TITLE).length).toBeGreaterThan(0);
}

/**
 * A `bridgeApi.getRouteEligibility` stand-in built from the two per-route
 * mocks a test already has.
 *
 * # Why the tests need this at all
 *
 * `fetchRouteEligibility` delegates to the CLIENT, because which endpoint
 * can answer for a route is a property of the deployment rather than of
 * the form. A component test that mocks `@/lib/api` therefore has to
 * supply that one method, and hand-rolling the dispatch in every file
 * would be a dozen copies of the rule free to drift from
 * `HttpBridgeClient`'s.
 *
 * So this mirrors the real client exactly: the two per-route endpoints
 * are asked through the supplied mocks and normalised by the production
 * normaliser, and a route the test supplied no `generic` handler for
 * rejects with `EligibilityEndpointUnpublishedError` — a deployment that
 * does not answer, which is how a test asks for the fail-closed path. A
 * test that wants the route-generic answer supplies `generic`, whose
 * return value is the real `GET /routes/{route}/eligibility` body.
 */
export function routeEligibilityFrom(handlers: {
  SolToGlc?: (address: string, wallet: string | null) => unknown;
  RhnToGlc?: (address: string, wallet: string | null) => unknown;
  /** For a test that models a deployment serving the route-agnostic endpoint. */
  generic?: (route: string, source: string | null, destination: string) => unknown;
}) {
  return async (route: string, source: string | null, destination: string) => {
    if (route === "SolToGlc" || route === "RhnToGlc") {
      const handler = handlers[route];
      if (!handler) throw new EligibilityEndpointUnpublishedError(route);
      const dto = await handler(destination, source);
      return normalizeRecipientEligibility(
        dto as Parameters<typeof normalizeRecipientEligibility>[0],
        route,
      );
    }
    if (!handlers.generic) throw new EligibilityEndpointUnpublishedError(route);
    const dto = await handlers.generic(route, source, destination);
    return normalizeRouteWalletEligibility(
      dto as Parameters<typeof normalizeRouteWalletEligibility>[0],
      route as Parameters<typeof normalizeRouteWalletEligibility>[1],
    );
  };
}

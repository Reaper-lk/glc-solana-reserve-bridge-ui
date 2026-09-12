import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  expectHeldOnlyByEligibility,
  primaryCta,
  renderWithQueryClient,
  selectNetwork,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { encodeBase58Check } from "@/lib/bridge/glc-address";
import { BridgeCard } from "@/features/bridge/BridgeCard";
import type * as EnvModule from "@/lib/config/env";

/**
 * The source-side minimum, and the three bugs it has had.
 *
 * # The history, because each fix caused the next bug
 *
 * 1. The UI displayed `GET /limits`' `min_transfer_amount` directly as the
 *    entry minimum. That figure is a NET-side on-chain floor
 *    (`limits.rs::enforce_transfer_amount` compares it against the amount
 *    AFTER the fee), so the entry floor was too low — "Min 99 GLC".
 * 2. It was replaced with a fixed "100 GLC" constant, correct only at the
 *    1% fee it was tuned for, and silently wrong at 6%.
 * 3. It was then DERIVED from `min_transfer_amount` and `bridge_fee_bps`
 *    at use time — arithmetic that was finally correct, against a rule
 *    that never was. A chain's net-side floor is not a statement about
 *    what a user may type, so the entry minimum tracked the fee and
 *    landed on figures like "102.06185566 GLC".
 *
 * # The rule now
 *
 * The backend states it directly: one policy floor, EXACTLY 100 GLC of
 * source-side GROSS on every route, published per route as `GET /chains`'
 * `min_transfer_atomic` and enforced by the same value at `POST
 * /transfers` and `POST /quote`. This UI renders it and does no
 * arithmetic on it.
 *
 * In particular it is NOT adjusted for the fee. The fee is deducted AFTER
 * the minimum is checked, so a 100 GLC transfer at 3% delivers 97 GLC —
 * below the minimum, and correct. Re-deriving a "grossed-up" entry floor
 * is bug 3 again.
 *
 * Nothing here writes 100 out as a literal: every expectation comes from
 * the fixture's `SOURCE_MINIMUM_ATOMIC`, so a policy change reaches the
 * screen without a UI release.
 *
 * Kept as its own file (not added to bridge-card.test.tsx) for the same
 * reason as bridge-card-sol-to-glc-redirect.test.tsx: the SolToGlc cases
 * need a `glcAddressVersions` env mock and a connected wallet that the
 * shared file's other ~30 tests do not need.
 */

/**
 * The policy floor, in whole GLC, taken from the fixture the mock backend
 * publishes rather than written out. `10_000_000_000` canonical 8dp.
 */
const MINIMUM_WHOLE_GLC = BigInt(fixtures.SOURCE_MINIMUM_ATOMIC) / 100_000_000n;

/**
 * The same figure at each source chain's own precision.
 *
 * Both render identically — "100 GLC" — because the policy is a whole
 * number of GLC and `display` trims to the significant digits. The
 * just-below inputs differ, because one atomic unit is 10^-8 GLC on
 * Goldcoin and 10^-6 GLC on the Solana mint.
 */
const GLC_TO_SOL_MINIMUM_DISPLAY = `${MINIMUM_WHOLE_GLC} GLC`;
const GLC_TO_SOL_MINIMUM_INPUT = `${MINIMUM_WHOLE_GLC}`;
const GLC_TO_SOL_JUST_BELOW_MINIMUM_INPUT = `${MINIMUM_WHOLE_GLC - 1n}.99999999`;

const SOL_TO_GLC_MINIMUM_DISPLAY = `${MINIMUM_WHOLE_GLC} GLC`;
const SOL_TO_GLC_MINIMUM_INPUT = `${MINIMUM_WHOLE_GLC}`;
const SOL_TO_GLC_JUST_BELOW_MINIMUM_INPUT = `${MINIMUM_WHOLE_GLC - 1n}.999999`;

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChains(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    // These tests exercise the minimum-amount bound, not the rolling-24h
    // windows — every pair here reads as eligible on BOTH sides so the
    // amount validation stays the only variable under test.
    getSolToGlcRecipientEligibility: (address: unknown, wallet: unknown) =>
      Promise.resolve({
        direction: "SolToGlc",
        address: String(address),
        wallet: wallet === null || wallet === undefined ? null : String(wallet),
        eligible: true,
        blocked_reason: null,
        blocked_reasons: [],
        retry_after: null,
        retry_after_seconds: null,
        source_wallet_retry_after: null,
        recipient_retry_after: null,
        window_seconds: 86_400,
      }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const envState = vi.hoisted(() => ({ glcAddressVersions: [111] as number[] }));
vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: { ...actual.env, glcAddressVersions: envState.glcAddressVersions },
  };
});

const WALLET_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_SOLANA_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const VALID_GOLDCOIN_RECIPIENT = encodeBase58Check(111, new Uint8Array(20));

const walletConnection = {
  status: "connected" as const,
  address: WALLET_ADDRESS as string | null,
  wallet: null,
  wallets: [],
  canSign: true,
  error: null,
  platform: "desktop" as const,
  connect: vi.fn(),
  disconnect: vi.fn(),
  dismissError: vi.fn(),
};

const depositCapability = vi.fn(() => ({ available: true as const }));

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => walletConnection,
  useDepositToReserve: () => ({ capability: depositCapability, deposit: vi.fn() }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  // The FROM panel reads a source balance; with no wallet connected the
  // hook short-circuits before the query, so a minimal stub is enough.
  useTokenBalance: () => ({ isPending: true, isError: false, data: undefined }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  // The FROM panel's Solana connect control: desktop, so the wallet list
  // rather than the deep-link flow, and no error to suppress.
  needsDeepLink: () => false,
  isUserRejection: () => false,
}));

function glcToSolQuote() {
  return {
    direction: "GlcToSol" as const,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "470000000",
    net_display_amount: "470.000000",
    source_decimals: 8,
    destination_decimals: 6,
    source_asset: "GLC (Goldcoin)",
    destination_asset: "GLC (Solana)",
  };
}

function solToGlcQuote() {
  return {
    direction: "SolToGlc" as const,
    gross_amount: "500000000",
    gross_display_amount: "500.000000",
    fee_bps: 300,
    fee_amount: "3000000000",
    fee_display_amount: "30.00000000",
    net_amount: "47000000000",
    net_display_amount: "470.00000000",
    source_decimals: 6,
    destination_decimals: 8,
    source_asset: "GLC (Solana)",
    destination_asset: "GLC (Goldcoin)",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  envState.glcAddressVersions = [111];
  walletConnection.status = "connected";
  walletConnection.address = WALLET_ADDRESS;
  walletConnection.canSign = true;
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  // The route registry every gate now consults. The default fixture is
  // the real shipping state: both legacy routes open, both Robinhood
  // routes implemented-but-disabled, the Solana<->Robinhood pair inert.
  getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  depositCapability.mockReturnValue({ available: true });
});

async function typeGlcToSolAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Solana recipient address"),
    VALID_SOLANA_RECIPIENT,
  );
}

/** The "minimum transfer" message renders in more than one place at once
 * (an inline field error and an accessible description on the disabled
 * submit button), so it must be asserted with `findAllByText`, not
 * `findByText` (which throws on more than one match). */
async function expectMinimumMessage(minimumDisplay: string) {
  expect(
    (
      await screen.findAllByText(
        new RegExp(`The minimum transfer is ${minimumDisplay}`, "i"),
      )
    ).length,
  ).toBeGreaterThan(0);
}

async function typeSolToGlcAmount(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
) {
  renderWithQueryClient(<BridgeCard />);
  // Networks are chosen in the two selectors; the route is derived from
  // the pair. `selectNetwork` waits for `GET /chains` to answer first —
  // availability is never assumed, so the control is genuinely disabled
  // until then.
  await selectNetwork(user, "Source network", /Solana/);
  await waitFor(() => expect(getLimits).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/Amount in GLC/i), amount);
  await user.type(
    screen.getByLabelText("Goldcoin destination address"),
    VALID_GOLDCOIN_RECIPIENT,
  );
}

describe("BridgeCard — minimum bridge amount (Goldcoin -> Solana)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(glcToSolQuote());
  });

  it("displays the fee-derived 102.06185566 GLC minimum, never the backend's raw 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    expect(
      await screen.findByText(new RegExp(`Min ${GLC_TO_SOL_MINIMUM_DISPLAY}`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC\b/)).not.toBeInTheDocument();
  });

  it("rejects one atomic unit below the exact minimum", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, GLC_TO_SOL_JUST_BELOW_MINIMUM_INPUT);
    await expectMinimumMessage(GLC_TO_SOL_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  /**
   * The boundary the policy is written in. This test used to assert the
   * OPPOSITE — that 100 GLC was refused as "the stale pre-fix minimum" —
   * back when the entry floor was derived from a chain's net-side check
   * and landed above 102. The rule changed, so the assertion inverted.
   */
  it("accepts exactly 100 GLC, the policy floor", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "100");
    // The amount cleared every bound: the gate got as far as eligibility,
    // which is ordered after all of them. `GlcToSol` cannot clear THAT
    // yet — the backend publishes no endpoint for it — so an enabled
    // button is not a state this route can reach.
    await expectHeldOnlyByEligibility();
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  /**
   * And the fee still comes off afterwards, leaving a destination figure
   * below the minimum — which is the policy working, not a violation of
   * it. Asserted on the quote the form actually shows.
   */
  it("still charges the ordinary fee on a minimum transfer", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "100");
    await expectHeldOnlyByEligibility();
    expect(getQuote).toHaveBeenCalled();
    const quoted = getQuote.mock.calls.at(-1)?.[0] as { gross_amount: string };
    expect(BigInt(quoted.gross_amount)).toBe(BigInt(fixtures.SOURCE_MINIMUM_ATOMIC));
  });

  it("accepts exactly the minimum at Goldcoin precision", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, GLC_TO_SOL_MINIMUM_INPUT);
    await expectHeldOnlyByEligibility();
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above the minimum", async () => {
    const user = userEvent.setup();
    await typeGlcToSolAmount(user, "500");
    await expectHeldOnlyByEligibility();
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});

describe("BridgeCard — minimum bridge amount (Solana -> Goldcoin)", () => {
  beforeEach(() => {
    getQuote.mockResolvedValue(solToGlcQuote());
  });

  it("displays the fee-derived 102.061856 GLC minimum, never the backend's raw 99 GLC net-side figure", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    expect(
      await screen.findByText(new RegExp(`Min ${SOL_TO_GLC_MINIMUM_DISPLAY}`)),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Min 99 GLC\b/)).not.toBeInTheDocument();
  });

  it("rejects one atomic unit below the exact minimum", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, SOL_TO_GLC_JUST_BELOW_MINIMUM_INPUT);
    await expectMinimumMessage(SOL_TO_GLC_MINIMUM_DISPLAY);
    expect(primaryCta()).toBeDisabled();
  });

  /**
   * The boundary the policy is written in. This test used to assert the
   * OPPOSITE — that 100 GLC was refused as "the stale pre-fix minimum" —
   * back when the entry floor was derived from a chain's net-side check
   * and landed above 102. The rule changed, so the assertion inverted.
   */
  it("accepts exactly 100 GLC, the policy floor", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "100");
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  /**
   * And the fee still comes off afterwards, leaving a destination figure
   * below the minimum — which is the policy working, not a violation of
   * it. Asserted on the quote the form actually shows.
   */
  it("still charges the ordinary fee on a minimum transfer", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "100");
    await waitFor(() => expect(primaryCta()).toBeEnabled());
    expect(getQuote).toHaveBeenCalled();
    const quoted = getQuote.mock.calls.at(-1)?.[0] as { gross_amount: string };
    expect(BigInt(quoted.gross_amount)).toBe(BigInt(fixtures.SOURCE_MINIMUM_ATOMIC));
  });

  it("accepts exactly the minimum at the mint's precision", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, SOL_TO_GLC_MINIMUM_INPUT);
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });

  it("accepts a normal amount above the minimum", async () => {
    const user = userEvent.setup();
    await typeSolToGlcAmount(user, "500");
    const submit = primaryCta();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/minimum transfer is/i)).not.toBeInTheDocument();
  });
});

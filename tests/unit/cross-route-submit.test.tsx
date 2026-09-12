import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import {
  primaryCta,
  renderWithQueryClient,
  routeEligibilityFrom,
  selectNetwork,
} from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
import { ELIGIBILITY_UNAVAILABLE_TITLE } from "@/lib/bridge/eligibility";
import type * as EnvModule from "@/lib/config/env";
import type * as EvmModule from "@/lib/evm";
import { BridgeCard } from "@/features/bridge/BridgeCard";

/**
 * Submitting the two CROSS ROUTES end to end, from the form.
 *
 * # What this file is for
 *
 * Neither cross route has a create endpoint: `POST /transfers` refuses both
 * by name, exactly as it refuses `SolToGlc`/`RhnToGlc`. Each is started by
 * the depositor's own on-chain transaction, so the UI constructs it — and
 * the two constructions differ in the one field neither chain will check:
 *
 * | route | chain call | route named? | destination |
 * |---|---|---|---|
 * | `SolToRhn` | Solana `deposit_to_reserve` | NO — classified from the payload | `0x…` EVM address as UTF-8 |
 * | `RhnToSol` | custody `deposit(0x04, …)` | YES, explicitly | 32 raw Solana pubkey bytes |
 *
 * So these tests assert the exact arguments that reach each chain call. A
 * wrong destination is not refused: the Solana program and the custody
 * contract both accept any 1..64 bytes, the service parses them afterwards,
 * and by then the GLC is committed. A `SolToRhn` deposit carrying a Goldcoin
 * address does not fail — it SUCCEEDS onto Goldcoin.
 *
 * Every expectation is read off the merged backend: `destination_is_robinhood`
 * / `parse_robinhood_destination` (`service/src/solana/indexer.rs`),
 * `validate_solana_destination` (`service/src/robinhood/fold.rs`), the route
 * constants in `contracts/src/GlcRobinhoodBridge.sol`, and the payloads
 * `service/tests/cross_route_real_node_acceptance.rs` deposits with.
 */

const getStatus = vi.fn();
const getChains = vi.fn();
const getLimits = vi.fn();
const getReserve = vi.fn();
const getQuote = vi.fn();
const createTransfer = vi.fn();
const listTransfers = vi.fn();
const getSolToGlcRecipientEligibility = vi.fn();
const getRhnToGlcRecipientEligibility = vi.fn();
/**
 * `bridgeApi.getChains`, which BOTH the `useChains` hook and the submit
 * path's fresh re-read go through — they are the same function, called at
 * two different moments. So a test about the fresh read differing from the
 * cached one has to change what it returns AFTER the button has enabled,
 * which `submitRhnToSol`'s `beforeClick` hook is for.
 */
const getChainsDirect = vi.fn();

vi.mock("@/lib/api", async () => ({
  // The real error factories: BridgeForm imports them by name, and a
  // partial mock of this module would leave them undefined.
  ...(await import("@/lib/api/errors")),
  bridgeApi: {
    getStatus: (...args: unknown[]) => getStatus(...args),
    getChains: (...args: unknown[]) => getChainsDirect(...args),
    getLimits: (...args: unknown[]) => getLimits(...args),
    getReserve: (...args: unknown[]) => getReserve(...args),
    getQuote: (...args: unknown[]) => getQuote(...args),
    createTransfer: (...args: unknown[]) => createTransfer(...args),
    listTransfers: (...args: unknown[]) => listTransfers(...args),
    getSolToGlcRecipientEligibility: (...args: unknown[]) =>
      getSolToGlcRecipientEligibility(...args),
    // The one method `fetchRouteEligibility` calls. Built from the
    // per-route mocks above by the same rule `HttpBridgeClient` uses, so
    // a route with no landed endpoint rejects here exactly as it would
    // against the real backend.
    getRouteEligibility: routeEligibilityFrom({
      SolToGlc: (address: string, wallet: string | null) =>
        getSolToGlcRecipientEligibility(address, wallet),
      RhnToGlc: (address: string, wallet: string | null) =>
        getRhnToGlcRecipientEligibility(address, wallet),
    }),
    getRhnToGlcRecipientEligibility: (...args: unknown[]) =>
      getRhnToGlcRecipientEligibility(...args),
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/bridge",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, env: { ...actual.env, glcAddressVersions: [111] } };
});

/** The connected Solana wallet, for the `SolToRhn` source leg. */
const SOLANA_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
/** The Solana DESTINATION, for `RhnToSol`. A different key from the wallet. */
const SOLANA_RECIPIENT = "6dNVMXg1dZPhbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zY";
/** The EVM destination, for `SolToRhn`. Mixed case, so it carries a checksum. */
const EVM_RECIPIENT = getAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
/** The connected EVM wallet, for the `RhnToSol` source leg. */
const EVM_WALLET = "0xdD870fA1b7C4700F2BD7f44238821C26f7392148";
/** A Goldcoin destination, for the `RhnToGlc` regression guard. */
const GOLDCOIN_RECIPIENT = "mzBc4XEFSdzCDcTxAgf6EZXgsZWpztRhef";

const solanaDeposit = vi.fn();
const solanaCapability = vi.fn();

vi.mock("@/lib/solana", () => ({
  useWalletConnection: () => ({
    status: "connected" as const,
    address: SOLANA_WALLET,
    wallet: { name: "Phantom" },
    wallets: [],
    canSign: true,
    error: null,
    platform: "desktop" as const,
    connect: vi.fn(),
    disconnect: vi.fn(),
    dismissError: vi.fn(),
  }),
  useDepositToReserve: () => ({
    capability: solanaCapability,
    deposit: solanaDeposit,
  }),
  isValidAddress: (value: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),
  // A real balance: the FROM panel renders it, and the amount leg of the
  // gate needs a figure to compare against.
  useTokenBalance: () => ({
    isPending: false,
    isError: false,
    data: { raw: "100000000000", decimals: 6, symbol: "GLC" },
  }),
  isTokenBalanceAvailable: () => true,
  walletQueryKeys: { balances: () => ["solana", "balance"] },
  needsDeepLink: () => false,
  isUserRejection: () => false,
  buildDeepLinks: () => [],
  // Re-exported from the real module: the destination encoder needs the
  // genuine base58 decode, not a stub, because the BYTES are under test.
  solanaPubkeyBytes: (value: string) => {
    try {
      return new PublicKey(value).toBytes();
    } catch {
      return null;
    }
  },
}));

const DEPLOYMENT = {
  chainId: 4663,
  chainName: "Robinhood Chain",
  rpcUrl: "https://rpc.example.invalid",
  bridgeAddress: "0xbaEdFFdAC19fC9c1F025f8F6F74e633aB2708DBf",
  tokenAddress: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
};

const robinhoodDeposit = vi.fn();

vi.mock("@/lib/evm", async (importOriginal) => {
  const actual = await importOriginal<typeof EvmModule>();
  return {
    ...actual,
    robinhoodDeployment: () => DEPLOYMENT,
    useEvmWallet: () => ({
      wallets: [],
      hasInjectedWallet: true,
      address: EVM_WALLET,
      chainId: DEPLOYMENT.chainId,
      connecting: false,
      deployment: DEPLOYMENT,
      onExpectedChain: true,
      connect: vi.fn(),
      disconnect: vi.fn(),
      switchChain: vi.fn(),
      getProvider: () => null,
    }),
    useRobinhoodDeposit: () => ({ deposit: robinhoodDeposit }),
    useRobinhoodGlcBalance: () => ({
      isPending: false,
      isError: false,
      data: { raw: "10000000000000000000000", decimals: 18, symbol: "GLC" },
    }),
  };
});

/** Every route open, which is the state both cross routes need to be startable. */
const OPEN_CHAINS = () =>
  fixtures.chainsFixture(() => new Date(), { robinhoodOpen: true });

function quoteFor(direction: string) {
  return {
    direction,
    gross_amount: "50000000000",
    gross_display_amount: "500.00000000",
    fee_bps: fixtures.routeFeeBps(direction as never),
    fee_amount: "1500000000",
    fee_display_amount: "15.00000000",
    net_amount: "48500000000",
    net_display_amount: "485.00000000",
    source_decimals: 6,
    destination_decimals: 18,
    source_asset: "GLC (Solana)",
    destination_asset: "GLC (Robinhood)",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  solanaCapability.mockReturnValue({ available: true, reason: null, message: null });
  solanaDeposit.mockResolvedValue({ signature: "s".repeat(64) });
  robinhoodDeposit.mockResolvedValue({ hash: `0x${"d".repeat(64)}` });
  getStatus.mockResolvedValue(fixtures.statusFixture(() => new Date()));
  getChains.mockResolvedValue(OPEN_CHAINS());
  getChainsDirect.mockResolvedValue(OPEN_CHAINS());
  getLimits.mockResolvedValue(fixtures.limitsFixture());
  getReserve.mockResolvedValue(fixtures.reserveFixture());
  getQuote.mockImplementation((request: { direction: string }) =>
    Promise.resolve(quoteFor(request.direction)),
  );
  listTransfers.mockResolvedValue({ items: [], next_cursor: null, as_of: 1_700_000_000 });
  // The backend ECHOES the address and wallet back, and the UI discards a
  // verdict whose echo does not match what the form now holds — so the mock
  // has to echo the real inputs, lowercase for the wallet exactly as the
  // backend spells it.
  getRhnToGlcRecipientEligibility.mockResolvedValue({
    direction: "RhnToGlc",
    address: GOLDCOIN_RECIPIENT,
    wallet: EVM_WALLET.toLowerCase(),
    eligible: true,
    blocked_reason: null,
    blocked_reasons: [],
    retry_after: null,
    retry_after_seconds: null,
    window_seconds: 86_400,
  });
});

/**
 * # The two cross routes are currently GATED, not broken
 *
 * `SolToRhn` and `RhnToSol` are fully implemented here — the payload
 * encodings, the route ids and the funding paths are all in place and
 * pinned by `cross-route-destination.test.ts` (the encoders, byte for
 * byte) and `evm-deposit.test.ts` (the calldata `deposit()` actually
 * names, including that `RhnToSol` sends route `0x04` with the 32 raw
 * pubkey bytes to the V2 contract).
 *
 * What they do NOT have is a published rolling-24h eligibility endpoint.
 * Every route now requires an authoritative both-sides verdict before a
 * wallet may be opened, so both cross routes refuse at that gate. These
 * tests assert the refusal is total: nothing signed, nothing created,
 * and no substitution of one of the two Goldcoin-payout endpoints for a
 * question they do not answer.
 *
 * When the backend's route-agnostic endpoint lands, these expectations
 * invert and the submission assertions this block replaced come back —
 * which is why the encodings are pinned at the unit level, where the gate
 * cannot hide a regression in them.
 */
describe("SolToRhn — refused until its eligibility endpoint exists", () => {
  it("never opens the wallet, and never asks a Goldcoin-payout endpoint", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Robinhood/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(
      screen.getByLabelText("Robinhood Chain recipient address"),
      EVM_RECIPIENT,
    );

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());

    expect(solanaDeposit).not.toHaveBeenCalled();
    // Asking `/recipients/sol-to-glc/eligibility` about a Robinhood-bound
    // transfer would be asking about a window that does not govern it.
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("still quotes the route it is about to be refused on", async () => {
    // The quote is not gated on eligibility: a user is entitled to see
    // the fee and the received figure for the transfer they cannot yet
    // make, and pricing the WRONG route would be its own defect.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Robinhood/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");

    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "SolToRhn" }),
        expect.anything(),
      ),
    );
    expect(getQuote).not.toHaveBeenCalledWith(
      expect.objectContaining({ direction: "SolToGlc" }),
      expect.anything(),
    );
  });

  it("sends nothing at all when the route is closed either", async () => {
    // Fail-closed is unchanged by any of the above: availability still
    // comes from `/chains` alone, and a closed route cannot be submitted.
    getChains.mockResolvedValue(fixtures.chainsFixture(() => new Date()));
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Solana/);
    await selectNetwork(user, "Destination network", /Robinhood/);

    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());
    expect(solanaDeposit).not.toHaveBeenCalled();
  });
});

describe("RhnToSol — refused until its eligibility endpoint exists", () => {
  it("never builds an EVM transaction, whatever else is open", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Robinhood/);
    await selectNetwork(user, "Destination network", /Solana/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(screen.getByLabelText("Solana recipient address"), SOLANA_RECIPIENT);

    expect(
      (await screen.findAllByText(ELIGIBILITY_UNAVAILABLE_TITLE)).length,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(primaryCta()).toBeDisabled());
    await user.click(primaryCta());

    expect(robinhoodDeposit).not.toHaveBeenCalled();
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("quotes the route it is about to be refused on", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Robinhood/);
    await selectNetwork(user, "Destination network", /Solana/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");

    await waitFor(() =>
      expect(getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "RhnToSol" }),
        expect.anything(),
      ),
    );
    expect(getQuote).not.toHaveBeenCalledWith(
      expect.objectContaining({ direction: "RhnToGlc" }),
      expect.anything(),
    );
  });
});

describe("the two sibling routes keep their own payloads", () => {
  it("RhnToGlc still names 0x02 and sends the Goldcoin text", async () => {
    // The regression guard for the route argument being threaded through:
    // the existing route must be untouched by the new one.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await selectNetwork(user, "Source network", /Robinhood/);
    await selectNetwork(user, "Destination network", /Goldcoin/);
    await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
    await user.type(
      screen.getByLabelText("Goldcoin destination address"),
      GOLDCOIN_RECIPIENT,
    );
    await waitFor(() => expect(primaryCta()).toBeEnabled());
    await user.click(primaryCta());

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalledTimes(1));
    const call = robinhoodDeposit.mock.calls[0]![0] as {
      route: string;
      destination: string;
    };
    expect(call.route).toBe("RhnToGlc");
    // UTF-8 text, 34 bytes — not 32 raw bytes.
    expect((call.destination.length - 2) / 2).toBe(34);
    // And this route DOES consult the eligibility endpoint.
    expect(getRhnToGlcRecipientEligibility).toHaveBeenCalled();
  });
});

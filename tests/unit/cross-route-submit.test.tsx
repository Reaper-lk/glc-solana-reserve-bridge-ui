import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { bytesToHex, getAddress } from "viem";
import { PublicKey } from "@solana/web3.js";
import { primaryCta, renderWithQueryClient, selectNetwork } from "./test-utils";
import * as fixtures from "@/lib/api/mock/fixtures";
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
    getRhnToGlcRecipientEligibility: (...args: unknown[]) =>
      getRhnToGlcRecipientEligibility(...args),
  },
  recipientRateLimitedError: (await import("@/lib/api/errors")).recipientRateLimitedError,
  sourceWalletRateLimitedError: (await import("@/lib/api/errors"))
    .sourceWalletRateLimitedError,
  robinhoodPredepositError: (await import("@/lib/api/errors")).robinhoodPredepositError,
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
  bridgeAddress: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
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

/** Fills and submits a `SolToRhn` transfer: Solana source, EVM destination. */
async function submitSolToRhn(
  user: ReturnType<typeof userEvent.setup>,
  destination: string = EVM_RECIPIENT,
) {
  await selectNetwork(user, "Source network", /Solana/);
  await selectNetwork(user, "Destination network", /Robinhood/);
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(
    screen.getByLabelText("Robinhood Chain recipient address"),
    destination,
  );
  await waitFor(() => expect(primaryCta()).toBeEnabled());
  await user.click(primaryCta());
}

/** Fills and submits an `RhnToSol` transfer: Robinhood source, Solana destination. */
async function submitRhnToSol(
  user: ReturnType<typeof userEvent.setup>,
  options: { destination?: string; beforeClick?: () => void } = {},
) {
  await selectNetwork(user, "Source network", /Robinhood/);
  await selectNetwork(user, "Destination network", /Solana/);
  await user.type(screen.getByLabelText(/Amount in GLC/i), "500");
  await user.type(
    screen.getByLabelText("Solana recipient address"),
    options.destination ?? SOLANA_RECIPIENT,
  );
  await waitFor(() => expect(primaryCta()).toBeEnabled());
  // Anything that should be true of the FRESH read but not the cached one
  // is applied here: after the gate has opened, before the click.
  options.beforeClick?.();
  await user.click(primaryCta());
}

describe("SolToRhn — the Solana deposit that selects Robinhood", () => {
  it("submits with the checksummed EVM address as the payload", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitSolToRhn(user);

    await waitFor(() => expect(solanaDeposit).toHaveBeenCalledTimes(1));
    const call = solanaDeposit.mock.calls[0]![0] as {
      destination: string;
      amountAtomic: bigint;
      obligationIndex: number;
    };
    // THE payload. `parse_robinhood_destination` does `str::from_utf8` then
    // `EvmAddress::from_str`, and the production rehearsal deposits with
    // `to_checksum_string().as_bytes()`.
    expect(call.destination).toBe(EVM_RECIPIENT);
    // 500 GLC at the mint's 6 decimals.
    expect(call.amountAtomic).toBe(500_000_000n);
    expect(typeof call.obligationIndex).toBe("number");
  });

  it("never sends a Goldcoin-shaped payload on this route", async () => {
    // The expensive failure: such a payload does not fail, it folds as
    // `SolToGlc` and pays out on Goldcoin.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitSolToRhn(user);

    await waitFor(() => expect(solanaDeposit).toHaveBeenCalledTimes(1));
    const { destination } = solanaDeposit.mock.calls[0]![0] as { destination: string };
    // `0` is not in the base58 alphabet, so this prefix is exactly what the
    // backend's classifier keys on and exactly what a Goldcoin address can
    // never have.
    expect(destination.startsWith("0x")).toBe(true);
    expect(destination).toHaveLength(42);
  });

  it("normalises a lowercase paste to the checksummed payload", async () => {
    // The same destination must produce the same bytes however it was
    // pasted — and the checksummed spelling is the one the service can
    // verify on arrival, which an all-lowercase one carries no means to do.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitSolToRhn(user, EVM_RECIPIENT.toLowerCase());

    await waitFor(() => expect(solanaDeposit).toHaveBeenCalledTimes(1));
    const { destination } = solanaDeposit.mock.calls[0]![0] as { destination: string };
    expect(destination).toBe(EVM_RECIPIENT);
    expect(destination).not.toBe(EVM_RECIPIENT.toLowerCase());
  });

  it("asks for no Goldcoin-payout eligibility", async () => {
    // The rolling 24-hour windows are GOLDCOIN-payout policy, and the
    // backend publishes exactly two eligibility endpoints, both `*-to-glc`.
    // Asking the `sol-to-glc` one about a Robinhood-bound transfer would be
    // asking about a limit that does not govern it.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitSolToRhn(user);

    await waitFor(() => expect(solanaDeposit).toHaveBeenCalledTimes(1));
    expect(getSolToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("quotes the route it is about to submit", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitSolToRhn(user);

    await waitFor(() => expect(solanaDeposit).toHaveBeenCalled());
    expect(getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "SolToRhn" }),
      expect.anything(),
    );
    expect(getQuote).not.toHaveBeenCalledWith(
      expect.objectContaining({ direction: "SolToGlc" }),
      expect.anything(),
    );
  });

  it("sends nothing at all when the route is closed", async () => {
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

describe("RhnToSol — the custody deposit that names route 0x04", () => {
  it("submits on the RhnToSol route with the 32 raw pubkey bytes", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitRhnToSol(user);

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalledTimes(1));
    const call = robinhoodDeposit.mock.calls[0]![0] as {
      route: string;
      destination: string;
      amountRaw: bigint;
    };
    // The route is an explicit contract argument and the one thing a
    // deposit cannot recover afterwards.
    expect(call.route).toBe("RhnToSol");
    // `validate_solana_destination` reads the raw form FIRST, by length.
    // This is the payload the production rehearsal deposits with.
    expect(call.destination).toBe(bytesToHex(new PublicKey(SOLANA_RECIPIENT).toBytes()));
    expect((call.destination.length - 2) / 2).toBe(32);
    // 500 GLC at Robinhood's 18 decimals, an exact canonical multiple.
    expect(call.amountRaw).toBe(500_000_000_000_000_000_000n);
  });

  it("never sends the Goldcoin text payload on this route", async () => {
    // The sibling route's encoding. The contract accepts either without
    // complaint; the service would park this one undeliverable, refundable
    // only by an operator, with the deposit already made.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitRhnToSol(user);

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalledTimes(1));
    const { destination } = robinhoodDeposit.mock.calls[0]![0] as { destination: string };
    // A UTF-8 base58 payload would be 43–44 bytes, not 32.
    expect((destination.length - 2) / 2).not.toBe(SOLANA_RECIPIENT.length);
  });

  it("asks for no Goldcoin-payout eligibility", async () => {
    // `RhnToSol` pays out on Solana, and there is no `rhn-to-sol`
    // eligibility endpoint to ask — requiring an answer would be a gate
    // nothing could satisfy.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitRhnToSol(user);

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalledTimes(1));
    expect(getRhnToGlcRecipientEligibility).not.toHaveBeenCalled();
  });

  it("still re-reads availability fresh before opening the wallet", async () => {
    // The half of the pre-deposit gate that DOES apply. The deposit is
    // irreversible, so a route that closed since the button enabled must
    // stop it — read from `/chains` directly, not from the cache.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitRhnToSol(user);

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalledTimes(1));
    expect(getChainsDirect).toHaveBeenCalled();
  });

  it("refuses when that fresh read says the route is no longer available", async () => {
    // The race this exists for: the route closes between the button
    // enabling and the click — another tab, an operator closing admission —
    // and the next thing that would happen is an irreversible deposit.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    let callsBeforeClick = 0;
    await submitRhnToSol(user, {
      beforeClick: () => {
        callsBeforeClick = getChainsDirect.mock.calls.length;
        const base = OPEN_CHAINS();
        getChainsDirect.mockResolvedValue({
          ...base,
          routes: base.routes.map((route) =>
            route.id === "RhnToSol"
              ? {
                  ...route,
                  available: false,
                  unavailable_reason: fixtures.DIRECTION_UNAVAILABLE_MESSAGE,
                }
              : route,
          ),
        });
      },
    });

    // The submit DID run and DID re-read — otherwise "no deposit" would be
    // true for the uninteresting reason that nothing happened at all.
    await waitFor(() =>
      expect(getChainsDirect.mock.calls.length).toBeGreaterThan(callsBeforeClick),
    );
    expect(robinhoodDeposit).not.toHaveBeenCalled();
  });

  it("refuses when the fresh read itself fails", async () => {
    // Unreadable availability is unknown availability, and unknown is a
    // refusal — the deposit cannot be taken back. This is the opposite
    // disposition to `SolToGlc`'s advisory re-check, which fails OPEN
    // because the backend's own admission check is a real floor there.
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    let callsBeforeClick = 0;
    await submitRhnToSol(user, {
      beforeClick: () => {
        callsBeforeClick = getChainsDirect.mock.calls.length;
        getChainsDirect.mockRejectedValue(new Error("chains unavailable"));
      },
    });

    await waitFor(() =>
      expect(getChainsDirect.mock.calls.length).toBeGreaterThan(callsBeforeClick),
    );
    expect(robinhoodDeposit).not.toHaveBeenCalled();
  });

  it("quotes the route it is about to submit", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithQueryClient(<BridgeCard />);
    await submitRhnToSol(user);

    await waitFor(() => expect(robinhoodDeposit).toHaveBeenCalled());
    expect(getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "RhnToSol" }),
      expect.anything(),
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

import type {
  BridgeApiClient,
  ListExplorerEventsParams,
  ListReserveHistoryParams,
  ListTransfersParams,
} from "../client";
import { badRequestError, directionUnavailableError, notFoundError } from "../errors";
import {
  bridgeStatusSchema,
  publicHealthSchema,
  reserveAvailabilitySchema,
  transferLimitsSchema,
} from "../schemas/status";
import { bridgeStatsSchema } from "../schemas/stats";
import { explorerEventListSchema } from "../schemas/explorer";
import { reserveHistoryListSchema } from "../schemas/reserves";
import { quoteOutputSchema, type QuoteOutputDto } from "../schemas/quote";
import {
  createTransferOutputSchema,
  createTransferRequestSchema,
  transferListSchema,
  transferViewSchema,
  type CreateTransferOutputDto,
  type CreateTransferRequest,
  type TransferViewDto,
} from "../schemas/transfer";
import * as fixtures from "./fixtures";

export type MockScenario =
  | "operational"
  | "paused"
  | "insufficient-liquidity"
  | "quota-exhausted"
  | "quota-paused";

export interface MockClientOptions {
  readonly scenario?: MockScenario;
  readonly latencyMs?: number;
  readonly now?: () => Date;
}

const GOLDCOIN_DECIMALS = 8;
const SOLANA_DECIMALS = 6;

function formatDisplay(atomic: number, decimals: number): string {
  return (atomic / 10 ** decimals).toFixed(decimals);
}

/**
 * In-memory client backing `NEXT_PUBLIC_BRIDGE_API_MODE=mock`.
 *
 * Every fixture is parsed through the same schema a live response would be —
 * a fixture that would not survive the real boundary fails the test suite.
 * `createTransfer` re-derives its fee/net figures with the same 1% math the
 * real backend uses, purely so the mock stays internally consistent; the
 * frontend proper never performs this calculation itself.
 */
export class MockBridgeClient implements BridgeApiClient {
  private readonly scenario: MockScenario;
  private readonly latencyMs: number;
  private readonly now: () => Date;
  private nextId = 5000;

  constructor(options: MockClientOptions = {}) {
    this.scenario = options.scenario ?? "operational";
    this.latencyMs = options.latencyMs ?? 220;
    this.now = options.now ?? (() => new Date());
  }

  private async delay<T>(value: T): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    return value;
  }

  async getStatus() {
    const raw =
      this.scenario === "paused"
        ? fixtures.pausedStatusFixture()
        : this.scenario === "quota-exhausted"
          ? fixtures.quotaExhaustedStatusFixture()
          : this.scenario === "quota-paused"
            ? fixtures.quotaPausedStatusFixture()
            : fixtures.statusFixture(this.now);
    return this.delay(bridgeStatusSchema.parse(raw));
  }

  async getLimits() {
    return this.delay(transferLimitsSchema.parse(fixtures.limitsFixture()));
  }

  async getReserve() {
    const raw =
      this.scenario === "insufficient-liquidity"
        ? fixtures.insufficientReserveFixture()
        : fixtures.reserveFixture();
    return this.delay(reserveAvailabilitySchema.parse(raw));
  }

  async getHealth() {
    return this.delay(publicHealthSchema.parse(fixtures.healthFixture()));
  }

  async getStats() {
    return this.delay(bridgeStatsSchema.parse(fixtures.statsFixture()));
  }

  async getQuote(request: {
    direction: "GlcToSol" | "SolToGlc";
    gross_amount: number;
  }): Promise<QuoteOutputDto> {
    if (request.gross_amount <= 0)
      throw badRequestError("gross_amount must be greater than zero");

    const feeBps = fixtures.BRIDGE_FEE_BPS;
    const fee = Math.floor((request.gross_amount * feeBps) / 10_000);
    const net = request.gross_amount - fee;
    const sourceDecimals =
      request.direction === "GlcToSol" ? GOLDCOIN_DECIMALS : SOLANA_DECIMALS;
    const destDecimals =
      request.direction === "GlcToSol" ? SOLANA_DECIMALS : GOLDCOIN_DECIMALS;

    const output = {
      direction: request.direction,
      gross_amount: request.gross_amount,
      gross_display_amount: formatDisplay(request.gross_amount, GOLDCOIN_DECIMALS),
      fee_bps: feeBps,
      fee_amount: fee,
      fee_display_amount: formatDisplay(fee, GOLDCOIN_DECIMALS),
      net_amount: net,
      net_display_amount: formatDisplay(net, GOLDCOIN_DECIMALS),
      source_decimals: sourceDecimals,
      destination_decimals: destDecimals,
      source_asset: request.direction === "GlcToSol" ? "GLC (Goldcoin)" : "GLC (Solana)",
      destination_asset:
        request.direction === "GlcToSol" ? "GLC (Solana)" : "GLC (Goldcoin)",
    };
    return this.delay(quoteOutputSchema.parse(output));
  }

  async getTransfer(id: number) {
    const found =
      this.created.get(id) ?? fixtures.transfersFixture().find((t) => t.id === id);
    if (!found) throw notFoundError("transfer");
    return this.delay(transferViewSchema.parse(found));
  }

  private created = new Map<number, TransferViewDto>();

  async createTransfer(request: CreateTransferRequest): Promise<CreateTransferOutputDto> {
    const validated = createTransferRequestSchema.parse(request);

    // Every unavailable cause returns the backend's single cause-agnostic
    // 409, exactly like the real service (DIRECTION_UNAVAILABLE_MESSAGE).
    if (this.scenario !== "operational") throw directionUnavailableError();

    const id = this.nextId++;
    const feeBps = fixtures.BRIDGE_FEE_BPS;
    const fee = Math.floor((validated.amount_atomic * feeBps) / 10_000);

    this.created.set(id, {
      id,
      direction: "GlcToSol",
      state: "AwaitingDeposit",
      gross_amount_atomic: validated.amount_atomic,
      fee_bps: feeBps,
      fee_amount_atomic: fee,
      net_amount_atomic: validated.amount_atomic - fee,
      created_at: Math.floor(this.now().getTime() / 1000),
      source_txid: null,
      source_confirmations: 0,
      required_source_confirmations: 12,
      destination_txid: null,
      failure_reason: null,
    });

    // A distinct mock address per request id, so dev/test flows exercise
    // "each new request gets a different deposit address" realistically.
    const output = {
      request_id: id,
      deposit_address: `GLCDep0sit${id.toString().padStart(6, "0")}1111111111111111111111`,
    };
    return this.delay(createTransferOutputSchema.parse(output));
  }

  async listTransfers(params: ListTransfersParams) {
    let items = [...fixtures.transfersFixture(), ...this.created.values()];
    if (params.state) items = items.filter((t) => t.state === params.state);
    items = items.sort((a, b) => b.created_at - a.created_at);
    return this.delay(
      transferListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }

  async listExplorerEvents(params: ListExplorerEventsParams) {
    let items = fixtures.explorerEventsFixture();
    if (params.direction) items = items.filter((e) => e.direction === params.direction);
    if (params.state) items = items.filter((e) => e.to_state === params.state);
    return this.delay(
      explorerEventListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }

  async listReserveHistory(params: ListReserveHistoryParams) {
    let items = fixtures.reserveHistoryFixture();
    if (params.direction) {
      const target =
        params.direction === "goldcoin" ? "GoldcoinReserve" : "SolanaReserve";
      items = items.filter((e) => e.direction === target);
    }
    return this.delay(
      reserveHistoryListSchema.parse({
        items,
        next_cursor: null,
        as_of: Math.floor(this.now().getTime() / 1000),
      }),
    );
  }
}

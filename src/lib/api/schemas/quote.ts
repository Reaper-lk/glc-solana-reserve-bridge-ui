import { z } from "zod";
import { atomicAmountSchema, directionSchema } from "./common";

/** Request body for `POST /quote` — `QuoteInput`. */
export const quoteRequestSchema = z.object({
  direction: directionSchema,
  gross_amount: z.number().int().positive(),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/**
 * `QuoteOutput` — the sole authoritative source for gross/fee/net. The UI
 * must never compute these itself; it only formats what this returns.
 * There is no expiry field: quotes are stateless and recomputed on demand.
 */
export const quoteOutputSchema = z.object({
  direction: directionSchema,
  gross_amount: atomicAmountSchema,
  gross_display_amount: z.string().min(1),
  fee_bps: z.number().int().nonnegative(),
  fee_amount: atomicAmountSchema,
  fee_display_amount: z.string().min(1),
  net_amount: atomicAmountSchema,
  net_display_amount: z.string().min(1),
  source_decimals: z.number().int().min(0).max(30),
  destination_decimals: z.number().int().min(0).max(30),
  source_asset: z.string().min(1),
  destination_asset: z.string().min(1),
});

export type QuoteOutputDto = z.infer<typeof quoteOutputSchema>;

import { env } from "@/lib/config/env";
import type { AddressRules } from "./glc-address";

/**
 * Goldcoin address rules, read from deployment configuration.
 *
 * Kept apart from `glc-address.ts` so the validator itself stays a pure
 * function of its inputs — that is what lets it be tested exhaustively against
 * generated addresses instead of whatever this deployment happens to be
 * configured with.
 */
export function goldcoinAddressRules(): AddressRules {
  return { versions: env.glcAddressVersions ?? [] };
}

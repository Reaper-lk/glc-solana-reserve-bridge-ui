import { env } from "./env";

/**
 * Every outbound URL the UI can render, derived from configuration.
 *
 * Builders return `null` rather than a broken or guessed URL when the
 * template is not configured. Callers render plain text in that case: a
 * chain reference with no working link is honest, a link to nowhere is not.
 */

function build(template: string | undefined, value: string): string | null {
  if (!template) return null;
  return template.replace("{value}", encodeURIComponent(value));
}

export function goldcoinTxUrl(txid: string): string | null {
  return build(env.glcExplorerTxUrl, txid);
}

export function goldcoinAddressUrl(address: string): string | null {
  return build(env.glcExplorerAddressUrl, address);
}

export function solanaTxUrl(signature: string): string | null {
  return build(env.solanaExplorerTxUrl, signature);
}

export function solanaAddressUrl(address: string): string | null {
  return build(env.solanaExplorerAddressUrl, address);
}

/** The host this deployment is served from, for the anti-phishing notice. */
export function primaryDomain(): string {
  try {
    return new URL(env.appUrl).host;
  } catch {
    return env.appUrl;
  }
}

export const officialDomains: readonly string[] = env.officialDomains;

export const externalLinks = {
  protocolRepo: env.protocolRepoUrl,
  docs: env.docsUrl,
  audits: env.auditsUrl,
  bugBounty: env.bugBountyUrl,
  support: env.supportUrl,
} as const;

/** Internal routes, centralised so the router and nav model cannot drift apart. */
export const routes = {
  home: "/",
  bridge: "/bridge",
  transfer: (id: number | string) => `/bridge/${id}`,
  activity: "/activity",
  explorer: "/explorer",
  explorerTx: (id: number | string) => `/explorer/tx/${id}`,
  reserves: "/reserves",
  status: "/status",
  fees: "/fees",
  security: "/security",
  verify: "/verify",
  wallets: "/wallets",
  faq: "/faq",
  glossary: "/glossary",
  support: "/support",
  paused: "/paused",
  terms: "/legal/terms",
  privacy: "/legal/privacy",
} as const;

"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletNotReadyError, WalletReadyState } from "@solana/wallet-adapter-base";
import { useCallback, useMemo } from "react";
import { useIsMounted } from "@/lib/hooks/useIsMounted";
import { toWalletFailure } from "../errors";
import { canOfferInstall, detectPlatform, readPlatformProbe } from "../platform";
import type {
  WalletConnection,
  WalletDescriptor,
  WalletPlatform,
  WalletStatus,
} from "../types";
import { useWalletRuntime } from "./provider";

/**
 * The translation layer.
 *
 * This is the only place wallet-adapter state is read. Everything above it sees
 * `WalletConnection` — our own type, built from strings and primitives. No
 * `PublicKey`, no `Wallet`, no `WalletAdapter`, no library enum escapes.
 *
 * Replacing wallet-adapter with Solana Kit means rewriting this file. Nothing
 * outside `src/lib/solana` would change.
 */

/** Install pages, used when a wallet is known but not detected. */
const INSTALL_URLS: Record<string, string> = {
  phantom: "https://phantom.app/download",
  solflare: "https://solflare.com/download",
  backpack: "https://backpack.app/download",
};

/** Wallets we advertise even when nothing is installed, so they are findable. */
const ADVERTISED: readonly { id: string; name: string }[] = [
  { id: "phantom", name: "Phantom" },
  { id: "solflare", name: "Solflare" },
  { id: "backpack", name: "Backpack" },
];

/**
 * A stable empty list, used when no provider is mounted. A fresh `[]` on each
 * render would defeat the memo it feeds.
 */
const EMPTY_WALLETS: ReturnType<typeof useWallet>["wallets"] = [];

function normaliseId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function isDetected(readyState: WalletReadyState): boolean {
  return (
    readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable
  );
}

export function useWalletConnectionBridge(): WalletConnection {
  const adapter = useWallet();
  const runtime = useWalletRuntime();
  const mounted = useIsMounted();

  const { configured, failure, setFailure } = runtime;

  // Detection depends on `window`, so the wallet list is only meaningful after
  // hydration. Reading it earlier would render a state the server could not
  // have produced (acceptance criterion: no incorrect state during hydration).
  const ready = configured && mounted;

  /**
   * Read the adapter's state through guarded locals.
   *
   * `useWallet()` returns a default context when no `WalletProvider` is mounted
   * — which is the correct state for a deployment with no RPC configured — and
   * that default logs an error the moment `wallets`, `wallet` or `publicKey` is
   * read. A dependency array is evaluated on every render regardless of the
   * guard inside the callback, so these must be short-circuited here rather
   * than referenced directly below.
   */
  const rawWallets = ready ? adapter.wallets : EMPTY_WALLETS;
  const rawWallet = ready ? adapter.wallet : null;

  /**
   * A wallet reporting `Installed` means something injected itself — an
   * extension, or the in-app browser of a wallet app. Either way, connecting
   * works here and the deep-link flow would be a loop back to this page.
   *
   * Read before hydration completes it would be a server-side guess, so like
   * the wallet list it waits for `ready`.
   */
  const platform = useMemo<WalletPlatform>(() => {
    if (!ready) return "desktop";
    const injected = rawWallets.some((entry) => isDetected(entry.readyState));
    return detectPlatform(readPlatformProbe(injected));
  }, [ready, rawWallets]);

  const wallets = useMemo<readonly WalletDescriptor[]>(
    () => buildWalletList(rawWallets, platform),
    [rawWallets, platform],
  );

  const status = useMemo<WalletStatus>(() => {
    if (!configured) return "unconfigured";
    if (!mounted) return "initialising";
    if (adapter.connecting) return "connecting";
    if (adapter.disconnecting) return "disconnecting";
    if (adapter.connected) return "connected";
    return "disconnected";
  }, [configured, mounted, adapter.connecting, adapter.disconnecting, adapter.connected]);

  const connect = useCallback(
    async (walletId: string) => {
      setFailure(null);

      const match = adapter.wallets.find(
        (entry) => normaliseId(entry.adapter.name) === walletId,
      );

      if (!match) {
        // A typed error, not a plain one: the classifier maps this to
        // "not-installed" and the user gets install guidance. A plain Error
        // falls through to the generic "something went wrong" copy.
        setFailure(toWalletFailure(new WalletNotReadyError()));
        return;
      }

      try {
        // Selection and connection are separate steps in the adapter. Both are
        // driven by an explicit user choice; neither happens on its own.
        adapter.select(match.adapter.name as Parameters<typeof adapter.select>[0]);
        await match.adapter.connect();
      } catch (error) {
        setFailure(toWalletFailure(error));
      }
    },
    [adapter, setFailure],
  );

  const disconnect = useCallback(async () => {
    setFailure(null);
    try {
      await adapter.disconnect();
    } catch (error) {
      setFailure(toWalletFailure(error));
    }
  }, [adapter, setFailure]);

  const dismissError = useCallback(() => setFailure(null), [setFailure]);

  const connectedDescriptor = useMemo<WalletDescriptor | null>(() => {
    if (!rawWallet) return null;
    const { adapter: inner, readyState } = rawWallet;
    return {
      id: normaliseId(inner.name),
      name: inner.name,
      iconUrl: inner.icon || null,
      installed: isDetected(readyState),
      installUrl: INSTALL_URLS[normaliseId(inner.name)] ?? null,
    };
  }, [rawWallet]);

  return {
    status,
    // A base58 string, never a PublicKey.
    address: ready && adapter.publicKey ? adapter.publicKey.toBase58() : null,
    wallet: connectedDescriptor,
    wallets,
    canSign: Boolean(ready && adapter.connected && adapter.signTransaction),
    error: failure,
    platform,
    connect,
    disconnect,
    dismissError,
  };
}

/**
 * Merge detected wallets with the ones we advertise.
 *
 * A user who sees only wallets they already have cannot discover what to
 * install, so undetected wallets stay on the list with an install link rather
 * than being hidden.
 */
function buildWalletList(
  detected: ReturnType<typeof useWallet>["wallets"],
  platform: WalletPlatform,
): readonly WalletDescriptor[] {
  const descriptors = new Map<string, WalletDescriptor>();

  /**
   * An install link is only honest where an extension can actually be added.
   * On a phone the wallet app is very likely already installed — it simply
   * cannot inject into this browser — so offering "Install" states something
   * we do not know and sends the user to a page that cannot help them.
   */
  const offerInstall = canOfferInstall(platform);
  const installUrlFor = (id: string) =>
    offerInstall ? (INSTALL_URLS[id] ?? null) : null;

  for (const entry of detected) {
    const id = normaliseId(entry.adapter.name);
    descriptors.set(id, {
      id,
      name: entry.adapter.name,
      iconUrl: entry.adapter.icon || null,
      installed: isDetected(entry.readyState),
      installUrl: installUrlFor(id),
    });
  }

  // Advertising undetected wallets is how a desktop user discovers what to
  // install. On iOS nothing can be detected, so the same list would be a page
  // of wallets all claiming to be missing — the deep-link flow replaces it.
  if (platform !== "ios") {
    for (const advertised of ADVERTISED) {
      if (descriptors.has(advertised.id)) continue;
      descriptors.set(advertised.id, {
        id: advertised.id,
        name: advertised.name,
        iconUrl: null,
        installed: false,
        installUrl: installUrlFor(advertised.id),
      });
    }
  }

  // Installed wallets first, then alphabetical within each group.
  return [...descriptors.values()].sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

"use client";

import { Dialog } from "radix-ui";
import { ExternalLink, Wallet, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/States";
import { isUserRejection, needsDeepLink, type WalletConnection } from "@/lib/solana";
import { routes } from "@/lib/config/links";
import { cn } from "@/lib/utils/cn";
import { MobileWalletConnect } from "./MobileWalletConnect";

/**
 * Wallet chooser.
 *
 * Built from our own primitives on Radix's Dialog rather than
 * `@solana/wallet-adapter-react-ui`, which ships a global stylesheet and a
 * black-box modal that would fight the token system.
 *
 * Wallets that are not installed stay on the list with an install link. A user
 * who only sees wallets they already have cannot discover what to install.
 */
export function WalletModal({
  open,
  onOpenChange,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: WalletConnection;
}) {
  const { wallets, error, connect, dismissError, status, platform } = connection;
  const connecting = status === "connecting";

  // Dismissing a wallet popup is a decision, not a fault, so it never surfaces
  // as an error state.
  const showError = error && !isUserRejection(error);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) dismissError();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="bg-ink-950/45 fixed inset-0 z-50" />
        <Dialog.Content
          className={cn(
            "shadow-elev-3 fixed z-50 bg-white focus:outline-none",
            // Full-screen sheet below md, centred dialog above (design spec D2).
            "inset-x-0 top-0 bottom-0 flex flex-col",
            "md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:w-[440px]",
            "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg",
          )}
        >
          <div className="border-ink-200 flex items-center justify-between border-b px-5 py-4">
            <Dialog.Title className="text-heading-2 text-ink-950">
              Connect a wallet
            </Dialog.Title>
            <Dialog.Close
              className="text-ink-700 hover:bg-ink-50 inline-flex size-11 items-center justify-center rounded-md md:size-9"
              aria-label="Close"
            >
              <X aria-hidden="true" className="size-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-body-sm text-ink-600 px-5 pt-4">
            Connecting shares your public address only. It never gives this site
            permission to move funds — every transaction is approved by you in your
            wallet.
          </Dialog.Description>

          <div className="flex-1 overflow-y-auto p-5">
            {showError && (
              <Alert
                level="warn"
                title={error.what}
                funds={error.funds}
                next={error.next}
                className="mb-4"
              />
            )}

            {/*
              On a platform where nothing can inject, a wallet list is a list of
              things that will not work. The deep-link flow replaces it outright
              rather than sitting underneath it as a fallback (design spec A11).
            */}
            {needsDeepLink(platform) || platform === "unsupported-webview" ? (
              <MobileWalletConnect platform={platform} />
            ) : wallets.length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No Solana wallet detected"
                description={
                  platform === "android"
                    ? "Install a Solana wallet app, then reopen this page."
                    : "Install a Solana wallet extension, then reload this page."
                }
              />
            ) : (
              <ul className="space-y-2">
                {wallets.map((wallet) => (
                  <li key={wallet.id}>
                    {wallet.installed ? (
                      <button
                        type="button"
                        disabled={connecting}
                        onClick={() => void connect(wallet.id)}
                        className={cn(
                          "border-ink-200 hover:bg-ink-50 flex min-h-14 w-full items-center gap-3 rounded-md border px-4 py-3 text-left",
                          "disabled:cursor-not-allowed disabled:opacity-60",
                        )}
                      >
                        <WalletIcon wallet={wallet} />
                        <span className="text-body text-ink-950 flex-1 font-medium">
                          {wallet.name}
                        </span>
                        <span className="text-body-sm text-ink-500">Detected</span>
                      </button>
                    ) : (
                      <a
                        href={wallet.installUrl ?? routes.wallets}
                        target={wallet.installUrl ? "_blank" : undefined}
                        rel={wallet.installUrl ? "noopener noreferrer" : undefined}
                        className="border-ink-200 hover:bg-ink-50 flex min-h-14 w-full items-center gap-3 rounded-md border px-4 py-3"
                      >
                        <WalletIcon wallet={wallet} />
                        <span className="text-body text-ink-600 flex-1">
                          {wallet.name}
                        </span>
                        <span className="text-body-sm text-ink-500 inline-flex items-center gap-1">
                          {/*
                            "Not installed" is a claim about the user's device.
                            Without an install link we were not able to check,
                            so we say what we actually know instead.
                          */}
                          {wallet.installUrl ? "Not installed" : "Not detected"}
                          {wallet.installUrl && (
                            <ExternalLink
                              aria-hidden="true"
                              className="size-3.5"
                              strokeWidth={2}
                            />
                          )}
                        </span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="border-ink-200 text-body-sm text-ink-600 border-t px-5 py-4">
            We will never ask for your seed phrase or private key.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WalletIcon({ wallet }: { wallet: { iconUrl: string | null; name: string } }) {
  if (!wallet.iconUrl) {
    return (
      <span className="bg-ink-100 flex size-8 shrink-0 items-center justify-center rounded-md">
        <Wallet aria-hidden="true" className="text-ink-500 size-4" strokeWidth={2} />
      </span>
    );
  }

  return (
    // The icon is supplied by the wallet as a data URI. It is decorative: the
    // wallet's name is always adjacent as text.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={wallet.iconUrl} alt="" aria-hidden="true" className="size-8 rounded-md" />
  );
}

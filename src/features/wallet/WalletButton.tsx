"use client";

import { DropdownMenu } from "radix-ui";
import { ChevronDown, Copy, ExternalLink, LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AddressCompact } from "@/components/ui/AddressChunks";
import { useWalletConnection } from "@/lib/solana";
import { solanaAddressUrl } from "@/lib/config/links";
import { WalletModal } from "./WalletModal";
import { WalletBalances } from "./WalletBalances";

/**
 * The header wallet control (design spec G1).
 *
 * Disconnected it is a secondary button; connected it becomes the address with
 * balances and a dropdown. Every state renders at a stable width so the header
 * does not jump as the connection settles.
 *
 * Before hydration it renders a neutral placeholder of the same size: the
 * server cannot know which wallets exist, and asserting a wallet state that
 * turns out to be wrong — even for one frame — is not acceptable on a page
 * about moving money.
 */
export function WalletButton() {
  const connection = useWalletConnection();
  const [modalOpen, setModalOpen] = useState(false);

  const { status, address, wallet, disconnect } = connection;

  if (status === "initialising") {
    return <div className="h-10 w-36" aria-hidden="true" />;
  }

  if (status === "unconfigured") {
    return (
      <Button
        variant="secondary"
        disabled
        disabledReason="Wallet connection is not configured for this deployment."
        // The header cannot absorb a sentence at 360px without overflowing.
        reasonPlacement="accessible"
      >
        Connect wallet
      </Button>
    );
  }

  if (status !== "connected" || !address) {
    const connecting = status === "connecting";
    return (
      <>
        <Button
          variant="secondary"
          loading={connecting}
          onClick={() => setModalOpen(true)}
        >
          Connect wallet
        </Button>
        <WalletModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          connection={connection}
        />
        <span aria-live="polite" className="sr-only">
          {connecting ? "Connecting wallet" : ""}
        </span>
      </>
    );
  }

  const explorerUrl = solanaAddressUrl(address);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="border-ink-300 hover:bg-ink-50 inline-flex h-10 items-center gap-2 rounded-md border bg-white px-3">
          <span className="flex flex-col items-start leading-tight">
            <AddressCompact address={address} lead={4} tail={4} />
            <WalletBalances className="text-mono-sm" />
          </span>
          <ChevronDown
            aria-hidden="true"
            className="text-ink-500 size-4"
            strokeWidth={2}
          />
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="border-ink-200 shadow-elev-2 z-50 min-w-56 rounded-md border bg-white p-1"
          >
            {wallet && (
              <p className="text-body-sm text-ink-500 px-3 py-2">
                Connected with {wallet.name}
              </p>
            )}

            <DropdownMenu.Item
              onSelect={() => void navigator.clipboard.writeText(address)}
              className="text-body text-ink-700 hover:bg-ink-50 focus:bg-ink-50 flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-3 outline-none"
            >
              <Copy aria-hidden="true" className="size-4" strokeWidth={2} />
              Copy address
            </DropdownMenu.Item>

            {explorerUrl && (
              <DropdownMenu.Item asChild>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body text-ink-700 hover:bg-ink-50 focus:bg-ink-50 flex min-h-10 items-center gap-2 rounded-sm px-3 outline-none"
                >
                  <ExternalLink aria-hidden="true" className="size-4" strokeWidth={2} />
                  View on explorer
                </a>
              </DropdownMenu.Item>
            )}

            <DropdownMenu.Separator className="bg-ink-200 my-1 h-px" />

            <DropdownMenu.Item
              onSelect={() => void disconnect()}
              className="text-body text-danger-700 hover:bg-danger-50 focus:bg-danger-50 flex min-h-10 cursor-pointer items-center gap-2 rounded-sm px-3 outline-none"
            >
              <LogOut aria-hidden="true" className="size-4" strokeWidth={2} />
              Disconnect
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <span aria-live="polite" className="sr-only">
        Wallet connected
      </span>
    </>
  );
}

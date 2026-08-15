"use client";

import { Dialog } from "radix-ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { moreNav, primaryNav } from "./navigation";
import { cn } from "@/lib/utils/cn";

/**
 * Mobile navigation (design spec D1 / F1).
 *
 * A sheet rather than a dropdown: every target is at least 44px tall and sits
 * within thumb reach. Radix supplies the focus trap, escape handling and scroll
 * lock, so keyboard and screen-reader behaviour is correct rather than
 * approximated.
 *
 * `walletSlot` renders at the top of the sheet: Header hides the wallet
 * control below `md` because the 64px bar can't fit mark + connect + menu
 * at 360px, so this sheet is the only place a mobile visitor can reach it.
 */
export function MobileNav({ walletSlot }: { walletSlot?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The sheet closes on the navigation event itself rather than in an effect
  // watching the pathname, which would fire an extra cascading render.
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        className="text-ink-700 hover:bg-ink-50 inline-flex size-11 items-center justify-center rounded-md md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu aria-hidden="true" className="size-6" strokeWidth={2} />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "bg-ink-950/45 fixed inset-0 z-50",
            "data-[state=open]:animate-[fade-in_var(--duration-base)_var(--ease-decelerate)]",
            "data-[state=closed]:animate-[fade-out_var(--duration-fast)_var(--ease-accelerate)]",
          )}
        />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 top-0 bottom-0 z-50 flex flex-col bg-white",
            "shadow-elev-3 focus:outline-none",
            "data-[state=open]:animate-[sheet-in_var(--duration-base)_var(--ease-decelerate)]",
            "data-[state=closed]:animate-[sheet-out_var(--duration-fast)_var(--ease-accelerate)]",
          )}
        >
          <div className="border-ink-200 flex h-16 items-center justify-between border-b px-4">
            <Dialog.Title className="text-heading-3 text-ink-950">Menu</Dialog.Title>
            <Dialog.Close
              className="text-ink-700 hover:bg-ink-50 inline-flex size-11 items-center justify-center rounded-md"
              aria-label="Close navigation menu"
            >
              <X aria-hidden="true" className="size-6" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="sr-only">
            Site navigation for the Goldcoin bridge
          </Dialog.Description>

          {walletSlot && <div className="border-ink-200 border-b p-4">{walletSlot}</div>}

          <nav className="flex-1 overflow-y-auto p-4" aria-label="Main">
            <ul className="space-y-1">
              {primaryNav.map((item) => (
                <li key={item.href}>
                  <MobileNavLink
                    item={item}
                    pathname={pathname}
                    onNavigate={close}
                    emphasis
                  />
                </li>
              ))}
            </ul>

            <p className="text-overline text-ink-500 mt-6 px-3 uppercase">More</p>
            <ul className="mt-2 space-y-1">
              {moreNav.map((item) => (
                <li key={item.href}>
                  <MobileNavLink item={item} pathname={pathname} onNavigate={close} />
                </li>
              ))}
            </ul>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MobileNavLink({
  item,
  pathname,
  onNavigate,
  emphasis = false,
}: {
  item: { label: string; href: string };
  pathname: string;
  onNavigate: () => void;
  emphasis?: boolean;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-body flex min-h-11 items-center rounded-md px-3",
        emphasis ? "text-heading-3 text-ink-950" : "text-ink-700",
        active && "bg-ink-50 text-ink-950",
      )}
    >
      {item.label}
    </Link>
  );
}

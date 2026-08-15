"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { MobileNav } from "./MobileNav";
import { moreNav, primaryNav } from "./navigation";
import { routes } from "@/lib/config/links";
import { cn } from "@/lib/utils/cn";

/**
 * Global header (design spec G1): 64px, sticky, hairline border, active item
 * marked with a 2px gold underline.
 *
 * `walletSlot` is where the connect control lands with the wallet PR. It is
 * left empty rather than filled with a placeholder button, because a control
 * that looks live and does nothing is exactly the first impression the design
 * review warns against.
 */
export function Header({ walletSlot }: { walletSlot?: ReactNode }) {
  const pathname = usePathname();

  return (
    <header className="border-ink-200 sticky top-0 z-40 border-b bg-white">
      <div className="max-w-page mx-auto flex h-16 items-center gap-4 px-4 md:px-6">
        <Link
          href={routes.home}
          className="text-heading-3 text-ink-950 flex shrink-0 items-center gap-2"
        >
          <BrandMark className="text-gold-500 size-7" />
          <span>Goldcoin Bridge</span>
        </Link>

        <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="text-label text-ink-600 hover:text-ink-950 inline-flex h-16 items-center gap-1 px-3">
              More
              <ChevronDown aria-hidden="true" className="size-4" strokeWidth={2} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={-8}
                className="border-ink-200 shadow-elev-2 z-50 min-w-56 rounded-md border bg-white p-1"
              >
                {moreNav.map((item) => (
                  <DropdownMenu.Item key={item.href} asChild>
                    <Link
                      href={item.href}
                      className="text-body text-ink-700 hover:bg-ink-50 focus:bg-ink-50 flex min-h-10 items-center rounded-sm px-3 outline-none"
                    >
                      {item.label}
                    </Link>
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/*
            The wallet control appears from `md` up, matching wireframe F1,
            which shows only the mark and the menu on a mobile header. At 360px
            the mark, a connect control and the menu button cannot share a
            64px bar without overflowing, and a financial page that scrolls
            sideways is a defect (acceptance criterion 6).

            Mobile wallet connection is a flow of its own — deep links and the
            return trip — and is tracked separately. Until it lands, mobile
            users reach wallet guidance through the navigation sheet.
          */}
          <div className="hidden md:flex md:items-center">{walletSlot}</div>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

function NavLink({
  item,
  pathname,
}: {
  item: { label: string; href: string };
  pathname: string;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "text-label relative inline-flex h-16 items-center px-3 transition-colors",
        active ? "text-ink-950" : "text-ink-600 hover:text-ink-950",
      )}
    >
      {item.label}
      {active && (
        <span
          aria-hidden="true"
          className="bg-gold-400 absolute inset-x-3 bottom-5 h-0.5 rounded-full"
        />
      )}
    </Link>
  );
}

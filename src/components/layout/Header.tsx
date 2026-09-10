"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { BrandMark } from "./BrandMark";
import { MobileNav } from "./MobileNav";
import { moreNav, primaryNav } from "./navigation";
import { routes } from "@/lib/config/links";
import { cn } from "@/lib/utils/cn";

/**
 * Global header (design spec G1): 64px, sticky, hairline border, active item
 * marked with a 2px gold underline.
 *
 * It carries no wallet control. Which wallet a visitor needs depends on the
 * network they are bridging FROM, and that is only known inside the bridge
 * form — a site-wide connect button asked most readers to connect a wallet
 * for a network they had not chosen. The connect controls now live in the
 * form's own FROM panel, next to the network that decides them.
 */
export function Header() {
  const pathname = usePathname();

  return (
    <header className="border-ink-200 bg-surface-raised sticky top-0 z-40 border-b">
      <div className="max-w-page mx-auto flex h-16 items-center gap-4 px-4 md:px-6">
        <Link
          href={routes.home}
          className="text-heading-3 text-ink-950 flex shrink-0 items-center gap-2"
        >
          <BrandMark />
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
                className={cn(
                  "border-ink-200 shadow-elev-2 bg-surface-raised z-50 min-w-56 origin-top rounded-md border p-1",
                  "data-[state=open]:[animation:menu-in_var(--duration-base)_var(--ease-decelerate)]",
                  "data-[state=closed]:[animation:menu-out_var(--duration-fast)_var(--ease-accelerate)]",
                )}
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

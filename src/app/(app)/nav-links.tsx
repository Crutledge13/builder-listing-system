"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";
import type { MenuLink } from "@/lib/menu";

export function NavLinks({ links, badges }: { links: MenuLink[]; badges?: Record<string, number> }) {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-[15px] [scrollbar-width:none]">
      {links.map((l) => {
        const active =
          l.href === "/media"
            ? path.startsWith("/media") && !path.startsWith("/media/requests")
            : path.startsWith(l.href);
        const n = badges?.[l.href];
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 sm:px-4",
              active ? "bg-soft font-semibold text-foreground" : "text-muted hover:bg-soft hover:text-foreground",
            )}
          >
            {l.label}
            {!!n && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-white">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

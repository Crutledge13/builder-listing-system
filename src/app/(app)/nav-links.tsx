"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

const LINKS = [
  { href: "/homes", label: "Homes" },
  { href: "/approvals", label: "Approvals" },
  { href: "/media", label: "Media" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 text-[15px]">
      {LINKS.map((l) => {
        const active = path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "relative rounded-full px-3 py-2 sm:px-4",
              active ? "font-semibold text-foreground" : "text-muted hover:bg-soft hover:text-foreground",
            )}
          >
            {l.label}
            {active && <span className="absolute inset-x-3 -bottom-[13px] h-[2px] rounded-full bg-foreground sm:inset-x-4" />}
          </Link>
        );
      })}
    </nav>
  );
}

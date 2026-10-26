"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

const LINKS = [
  { href: "/communities", label: "Communities" },
  { href: "/homes", label: "All homes" },
  { href: "/approvals", label: "Approvals" },
  { href: "/media", label: "Media" },
];

export function NavLinks({ showAdmin, photographer }: { showAdmin?: boolean; photographer?: boolean }) {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-[15px] [scrollbar-width:none]">
      {(photographer ? [{ href: "/jobs", label: "Your jobs" }] : [...LINKS, ...(showAdmin ? [{ href: "/admin", label: "Admin" }] : [])]).map((l) => {
        const active = l.href === "/media" ? path.startsWith("/media") && !path.startsWith("/media/requests") : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "shrink-0 whitespace-nowrap rounded-full px-3 py-2 sm:px-4",
              active ? "bg-soft font-semibold text-foreground" : "text-muted hover:bg-soft hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

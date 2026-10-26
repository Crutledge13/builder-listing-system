"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

const LINKS = [
  { href: "/homes", label: "Homes" },
  { href: "/approvals", label: "Approvals" },
  { href: "/media", label: "Media library" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cx(
            "rounded-lg px-3 py-1.5",
            path.startsWith(l.href)
              ? "bg-accent-soft font-medium text-accent"
              : "text-muted hover:bg-background hover:text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

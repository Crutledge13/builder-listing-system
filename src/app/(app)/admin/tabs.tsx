"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/format";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/builders", label: "Builders" },
  { href: "/admin/communities", label: "Communities" },
  { href: "/admin/people", label: "People" },
  { href: "/admin/requests", label: "Requests" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <div className="-mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {TABS.map((t) => {
        const on = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-[15px]",
              on ? "border-foreground font-semibold" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

import type { Role } from "@/lib/permissions";

export type MenuLink = { href: string; label: string; hint?: string };

// The few tabs that always show along the top, by role.
export function primaryTabs(role: Role): MenuLink[] {
  if (role === "photographer") return [{ href: "/jobs", label: "Your jobs" }];
  if (role === "platform_admin" || role === "listing_coordinator") {
    return [
      { href: "/tasks", label: "Tasks" },
      { href: "/communities", label: "Communities" },
      { href: "/homes", label: "Homes" },
      { href: "/media", label: "Media" },
      { href: "/reports", label: "Reports" },
    ];
  }
  const tabs: MenuLink[] = [
    { href: "/communities", label: "Communities" },
    { href: "/homes", label: "Homes" },
    { href: "/media", label: "Media" },
  ];
  if (role === "builder_owner" || role === "manager") tabs.push({ href: "/reports", label: "Reports" });
  return tabs;
}

// Everything else lives in the menu.
export function menuLinks(role: Role): MenuLink[] {
  if (role === "photographer") {
    return [{ href: "/jobs#earnings", label: "Earnings", hint: "Payments for your shoots" }];
  }
  const links: MenuLink[] = [{ href: "/approvals", label: "Approvals", hint: "Listings waiting on someone" }];
  if (role === "platform_admin" || role === "listing_coordinator") {
    links.push({ href: "/compliance", label: "MLS compliance", hint: "Deadlines, sold signals and rule checks" });
  }
  if (["builder_owner", "manager", "sales", "marketing"].includes(role)) {
    links.push({ href: "/attention", label: "Needs your attention", hint: "Homes waiting on an answer from your team" });
  }
  if (role !== "sales") links.push({ href: "/media/requests", label: "Photo requests", hint: "Shoots and deliveries" });
  if (["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role)) {
    links.push({ href: "/website-check", label: "Website check", hint: "Website, Builder Listings and MLS side by side" });
  }
  if (role === "builder_owner" || role === "manager") {
    links.push({ href: "/team", label: "Your team", hint: "Add people and set their access" });
  }
  if (role === "platform_admin") {
    links.push({ href: "/admin", label: "Admin", hint: "Builders, communities, people, payments, settings" });
  }
  return links;
}

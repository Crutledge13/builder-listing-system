import type { Role } from "@/lib/permissions";
import type { Feature } from "@/lib/features";

export type MenuLink = { href: string; label: string; hint?: string };

// The few tabs that always show along the top, by role.
// `off` is the builder's turned-off features (src/lib/features.ts).
// `setupOpen`: the builder's setup checklist isn't marked done yet (owners, managers, marketing).
export function primaryTabs(role: Role, enterOwnMls = false, off: ReadonlySet<Feature> = new Set(), setupOpen = false): MenuLink[] {
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
  if (enterOwnMls) tabs.unshift({ href: "/tasks", label: "MLS work" });
  if (setupOpen) tabs.unshift({ href: "/setup", label: "Setup" });
  if (!off.has("builder_tasks") && (role === "builder_owner" || role === "manager" || role === "marketing")) tabs.push({ href: "/todo", label: "Tasks" });
  if (!off.has("reports") && (role === "builder_owner" || role === "manager" || role === "marketing" || role === "sales")) tabs.push({ href: "/reports", label: "Reports" });
  return tabs;
}

// Everything else lives in the menu.
export function menuLinks(role: Role, off: ReadonlySet<Feature> = new Set()): MenuLink[] {
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
  links.push({ href: "/incentives", label: "Incentives", hint: role === "sales" ? "Current incentives for your communities" : "Builder, community and home incentives with end dates" });
  links.push({ href: "/plans", label: "Floor plans", hint: role === "platform_admin" || role === "listing_coordinator" ? "Set up each builder’s plans and room sizes" : "Your plans and their room sizes" });
  if (!off.has("comps")) links.push({ href: "/comps", label: "Comps", hint: role === "platform_admin" || role === "listing_coordinator" ? "Comp requests to pull and send" : "Ask for comps and see what's been sent" });
  if (!off.has("website_check") && ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role)) {
    links.push({ href: "/website-check", label: "Website check", hint: "Website, Builder Listings and MLS side by side" });
  }
  if (role === "builder_owner" || role === "manager" || role === "marketing") {
    links.push({ href: "/team", label: "Your team", hint: "Add people and set their access" });
    links.push({ href: "/setup", label: "Setup checklist", hint: "Everything we need to get your company set up" });
  }
  if (role === "platform_admin" || role === "listing_coordinator") {
    links.push({ href: "/setup", label: "Builder setup", hint: "Each builder’s setup checklist" });
  }
  if (role === "platform_admin" || role === "listing_coordinator") {
    links.push({ href: "/todo", label: "Builders’ tasks", hint: "What each builder’s team has open" });
  }
  if (["builder_owner", "manager", "marketing"].includes(role)) {
    links.push({ href: "/company", label: "Company details", hint: "Main contact, billing, website and title company" });
    links.push({ href: "/branding", label: "Company branding", hint: "Logo, colors and fonts" });
  } else if (role === "sales") {
    links.push({ href: "/branding", label: "Company branding", hint: "Logo and brand colors" });
  }
  if (role === "platform_admin" || role === "listing_coordinator") {
    links.push({ href: "/branding", label: "Builder branding", hint: "Each builder’s logo, colors and notes" });
    links.push({ href: "/company", label: "Builder company details", hint: "Each builder’s contact, billing, website and title company" });
  }
  if (role === "builder_owner") {
    links.push({ href: "/billing", label: "Billing", hint: "Your plan, invoices and what’s coming on the next one" });
  }
  if (role === "platform_admin") {
    links.push({ href: "/admin/billing", label: "Billing", hint: "Builder plans, charges and invoices" });
    links.push({ href: "/admin", label: "Admin", hint: "Builders, communities, people, payments, settings" });
  }
  return links;
}

import "server-only";
import { loadAlerts, ALERT_TITLES } from "@/components/alerts";
import { createClient } from "@/lib/supabase/server";
import { isStaff, type Role } from "@/lib/permissions";
import { mlsEntryFor } from "@/lib/mls-entry";

// "Needs you" (owners, 30 Oct 2026): the first thing each list shows on a
// phone, and the first number column on a computer. It's worked out for the
// person looking, so each role sees its own work:
// - builder owners, managers and marketing: homes waiting for their approval,
//   open alerts for the builder, and approved homes to enter in the MLS when
//   the builder enters its own listings;
// - salespeople: open alerts on their communities (they can't approve);
// - our staff: approved homes our team enters in the MLS, and alerts for our team.
// Only a view: the database still decides who sees which homes and alerts.

type HomeLike = { id: string; workflow_status: string; builder_id?: string | null };

export type NeedsYou = { label: string; header: string; reasons: Map<string, string> };

export async function loadNeedsYou(role: Role, builderId: string | null, homes: HomeLike[]): Promise<NeedsYou> {
  const staff = isStaff(role);
  const approver = ["builder_owner", "manager", "marketing"].includes(role);
  const supabase = await createClient();

  const [alerts, ownEntry, teamBuilders] = await Promise.all([
    loadAlerts(),
    approver ? mlsEntryFor(builderId).then((e) => e === "builder") : Promise.resolve(false),
    staff
      ? supabase.from("builder_settings").select("builder_id, mls_entry").then(({ data }) => new Set((data ?? []).filter((s) => s.mls_entry && s.mls_entry !== "our_team").map((s) => s.builder_id as string)))
      : Promise.resolve(new Set<string>()),
  ]);

  const reasons = new Map<string, string>();
  const add = (id: string, why: string) => { if (!reasons.has(id)) reasons.set(id, why); };

  for (const h of homes) {
    if (approver && h.workflow_status === "in_review") add(h.id, "Waiting for your approval");
    if (approver && ownEntry && h.workflow_status === "approved_for_mls") add(h.id, "Enter in the MLS");
    // teamBuilders holds the builders who don't use our team for MLS entry.
    if (staff && h.workflow_status === "approved_for_mls" && !(h.builder_id && teamBuilders.has(h.builder_id))) add(h.id, "Enter in the MLS");
  }
  for (const a of alerts) {
    if (!a.home_id) continue;
    if (staff && a.audience === "builder") continue; // the builder answers those
    add(a.home_id, ALERT_TITLES[a.kind] ?? "Needs a look");
  }

  return staff
    ? { label: "need attention", header: "Needs our team", reasons }
    : { label: "need you", header: "Needs you", reasons };
}

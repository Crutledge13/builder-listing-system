import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { communityCompleteness, communitySections, mergeCommunityDetails, MLS_BOARD_SELECT, type MlsBoard } from "@/lib/mls-fields";

// A builder's setup checklist. Every step is worked out from the builder's
// real data (people, logo, communities, plans, homes), so ticking things off
// happens on its own as the work gets done. The only stored choices are the
// optional steps a builder skipped and "we're all set"
// (builder_onboarding.skipped / finished_at, via public.builder_setup_state).

export type StepKey =
  | "agreement" | "legal_name" | "markets" | "owner"
  | "team" | "logo" | "brand_guide" | "website" | "billing" | "photo_contact" | "title_company"
  | "communities" | "community_setup" | "sales"
  | "plans" | "first_home";

// What can be put off. "communities" skips the whole communities section.
export type SkippableStep = "team" | "brand_guide" | "title_company" | "communities" | "plans";
export const SKIPPABLE: readonly SkippableStep[] = ["team", "brand_guide", "title_company", "communities", "plans"];

export type Step = {
  key: StepKey;
  group: "ours" | "company" | "communities" | "homes";
  title: string;
  why: string;
  done: boolean;
  skipped?: boolean;
  optional?: boolean;
  skipKey?: SkippableStep; // the stored choice that skips this step
  skipLabel?: string;      // the button for skipping it
  ourTeam?: boolean;       // our team does this one, not the builder
  detail?: string;
  href: string;
  cta: string;
};

export type CommunitySetup = {
  id: string;
  name: string;
  required: number;
  filled: number;
  missing: string[];
};

export type SetupState = {
  skipped: string[];
  finished_at: string | null;
  agreement_signed: boolean;
  billing_set: boolean;
  billing?: { name: string | null; email: string | null; phone: string | null } | null;
  can_edit_billing?: boolean;
};

export type Onboarding = {
  builderId: string;
  builderName: string;
  steps: Step[];           // the builder's checklist (what /setup shows them)
  ourSteps: Step[];        // before the invite (what our team sees on top)
  communities: CommunitySetup[];
  done: number;
  total: number;
  finishedAt: string | null;
  stage: Stage;
};

export const STAGES = ["getting_ready", "invited", "setting_up", "community_ready", "first_approved", "live"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  getting_ready: "Getting ready",
  invited: "Invited",
  setting_up: "Setting up",
  community_ready: "First community ready",
  first_approved: "First listing approved",
  live: "Live on the MLS",
};

export const GROUP_TITLES: Record<Step["group"], string> = {
  ours: "Before the invite (our team)",
  company: "Your company",
  communities: "Your communities",
  homes: "Floor plans and homes",
};

type Row = Record<string, unknown> & { builder_id: string };
const by = <T extends Row>(rows: T[] | null | undefined, id: string) => (rows ?? []).filter((r) => r.builder_id === id);

// Everything the checklist needs, for one or more builders, read as the
// signed-in person (RLS decides what they can see). Our staff can load every
// builder at once for Admin > Onboarding; a builder's owner or manager loads
// their own.
export async function loadOnboarding(supabase: SupabaseClient, builderIds: string[], opts: { staff: boolean }): Promise<Onboarding[]> {
  if (!builderIds.length) return [];
  const ids = builderIds;
  const [builders, settings, people, assignments, branding, photo, communities, details, plans, homes, onboarding] = await Promise.all([
    supabase.from("builders").select("id, name, legal_name").in("id", ids),
    supabase.from("builder_settings").select("builder_id, mls_boards, title_company_name").in("builder_id", ids),
    supabase.from("profiles").select("id, builder_id, role, is_active").in("builder_id", ids),
    supabase.from("community_assignments").select("profile_id, community_id"),
    supabase.from("builder_branding").select("builder_id, logo_path, brand_guide_path, website_url").in("builder_id", ids),
    supabase.from("builder_photo_info").select("builder_id, contact_name, contact_phone").in("builder_id", ids),
    supabase.from("communities").select("id, builder_id, name, county, mls_board, mls_fields").in("builder_id", ids).order("name"),
    supabase.from("mls_details").select("community_id, builder_id, data").in("builder_id", ids).not("community_id", "is", null),
    supabase.from("floor_plans").select("builder_id").in("builder_id", ids),
    supabase.from("homes").select("builder_id, workflow_status").in("builder_id", ids).is("deleted_at", null),
    opts.staff
      ? supabase.from("builder_onboarding").select("builder_id, agreement_signed_on, skipped, finished_at, billing_contact_name, billing_contact_email").in("builder_id", ids)
      : Promise.resolve({ data: null }),
  ]);

  // Builders read their own skipped steps and finish date through a function
  // (the onboarding table holds billing details they don't see).
  const states = new Map<string, SetupState>();
  if (opts.staff) {
    for (const r of onboarding.data ?? []) states.set(r.builder_id, {
      skipped: r.skipped ?? [], finished_at: r.finished_at, agreement_signed: !!r.agreement_signed_on,
      billing_set: !!r.billing_contact_name && !!r.billing_contact_email,
    });
  } else {
    await Promise.all(ids.map(async (id) => {
      const { data } = await supabase.rpc("builder_setup_state", { p_builder: id });
      if (data) states.set(id, data as SetupState);
    }));
  }

  const boardCodes = [...new Set((communities.data ?? []).map((c) => c.mls_board).filter(Boolean))] as string[];
  const { data: boardRows } = boardCodes.length
    ? await supabase.from("mls_boards").select(MLS_BOARD_SELECT).in("code", boardCodes)
    : { data: [] };
  const boards = new Map(((boardRows ?? []) as MlsBoard[]).map((b) => [b.code, b]));
  const staffFor = new Map((details.data ?? []).map((d) => [d.community_id as string, (d.data ?? {}) as Record<string, unknown>]));

  return ids.map((id) => {
    const b = (builders.data ?? []).find((x) => x.id === id);
    const st = states.get(id) ?? { skipped: [], finished_at: null, agreement_signed: false, billing_set: false };
    const skipped = new Set(st.skipped);
    // A required step put off for later: counts as done until they come back to it.
    const later = (key: SkippableStep, done: boolean) => ({
      done: done || skipped.has(key), skipped: skipped.has(key) && !done, skipKey: key, skipLabel: "Skip this for later",
    });
    const brand = by(branding.data as Row[], id)[0] as { logo_path?: string; brand_guide_path?: string; website_url?: string } | undefined;
    const contact = by(photo.data as Row[], id)[0] as { contact_name?: string; contact_phone?: string } | undefined;
    const team = by(people.data as Row[], id).filter((p) => p.is_active) as unknown as { id: string; role: string }[];
    const sales = team.filter((p) => p.role === "sales");
    const assigned = new Set((assignments.data ?? []).map((a) => a.profile_id));
    const unassigned = sales.filter((p) => !assigned.has(p.id)).length;
    const comms = by(communities.data as Row[], id) as unknown as { id: string; name: string; county: string | null; mls_board: string | null; mls_fields: Record<string, unknown> }[];
    const commSetup: CommunitySetup[] = comms.map((c) => {
      const sections = communitySections(c.mls_board ? boards.get(c.mls_board) : null);
      const score = communityCompleteness(c, mergeCommunityDetails(c.mls_fields, staffFor.get(c.id)), sections);
      return { id: c.id, name: c.name, required: score.required, filled: score.filled, missing: score.missing.map((f) => f.label) };
    });
    const commsReady = commSetup.filter((c) => c.filled === c.required).length;
    const homeRows = by(homes.data as Row[], id) as unknown as { workflow_status: string }[];
    const approved = homeRows.filter((h) => h.workflow_status === "approved_for_mls" || h.workflow_status === "live_on_mls").length;
    const live = homeRows.filter((h) => h.workflow_status === "live_on_mls").length;
    const planCount = by(plans.data as Row[], id).length;
    const markets = ((by(settings.data as Row[], id)[0]?.mls_boards ?? []) as string[]);
    const titleCompany = (by(settings.data as Row[], id)[0]?.title_company_name ?? null) as string | null;
    const owners = team.filter((p) => p.role === "builder_owner").length;

    const ourSteps: Step[] = [
      { key: "agreement", group: "ours", ourTeam: true, title: "Service agreement signed", why: "Signed before any of their listings go into the system.",
        done: st.agreement_signed, href: `/admin/onboarding#b-${id}`, cta: "Record it" },
      { key: "legal_name", group: "ours", ourTeam: true, title: "Legal company name", why: "Fills the MLS Owner Name box. It must match their deeds and contracts exactly.",
        done: !!b?.legal_name, detail: b?.legal_name ?? undefined, href: `/admin/onboarding#b-${id}`, cta: "Add it" },
      { key: "markets", group: "ours", ourTeam: true, title: "MLS markets", why: "Which MLS each of their communities goes to.",
        done: markets.length > 0, detail: markets.join(", ") || undefined, href: "/admin/builders", cta: "Set markets" },
      { key: "owner", group: "ours", ourTeam: true, title: "Primary contact added and invited", why: "The first login for their company and who we work with, until they name someone else on Company details. Send them their invite link from their card.",
        done: owners > 0, href: `/admin/onboarding#b-${id}`, cta: "Invite the primary contact" },
    ];

    const steps: Step[] = [
      { key: "team", group: "company", title: "Add your team", optional: true, skipKey: "team", skipLabel: "It’s just me for now",
        why: "Add each person who needs access and pick their role. Marketing runs listings day to day; salespeople see only their communities.",
        done: team.length > 1 || skipped.has("team"), skipped: skipped.has("team") && team.length <= 1,
        detail: `${team.length} ${team.length === 1 ? "person" : "people"} can sign in`, href: "/team", cta: "Add people" },
      { key: "logo", group: "company", title: "Upload your logo",
        why: "Shows on your screens, photographer jobs and realtor share pages. It never goes on MLS photos.",
        done: !!brand?.logo_path, href: "/branding", cta: "Upload logo" },
      { key: "brand_guide", group: "company", title: "Upload your brand guide", optional: true, skipKey: "brand_guide", skipLabel: "We don’t have one",
        why: "We read it for your colors, fonts and voice, so listing descriptions sound like you.",
        done: !!brand?.brand_guide_path || skipped.has("brand_guide"), skipped: skipped.has("brand_guide") && !brand?.brand_guide_path,
        href: "/branding#guide", cta: "Upload guide" },
      { key: "website", group: "company", title: "Add your website address",
        why: "Realtor share links send agents to your site for more info.",
        done: !!brand?.website_url, detail: brand?.website_url ?? undefined, href: "/company#website", cta: "Add website" },
      { key: "billing", group: "company", title: "Billing contact",
        why: "Who we send invoices to. Your company’s owner adds this.",
        done: st.billing_set, href: "/company#billing", cta: "Add billing contact" },
      { key: "title_company", group: "company", title: "Your default title company", optional: true, skipKey: "title_company", skipLabel: "We don’t use one",
        why: "Goes on every listing as the preferred title company. A community that uses a different one can set its own.",
        done: !!titleCompany || skipped.has("title_company"), skipped: skipped.has("title_company") && !titleCompany,
        detail: titleCompany ?? undefined, href: "/company#title-company", cta: "Add title company" },
      { key: "photo_contact", group: "company", title: "Who photographers call",
        why: "A name and phone number photographers see on every shoot, plus any access notes.",
        done: !!contact?.contact_name && !!contact?.contact_phone,
        detail: contact?.contact_name ? `${contact.contact_name}${contact.contact_phone ? `, ${contact.contact_phone}` : ""}` : undefined,
        href: "/media/requests?open=photo-contact#photo-contact", cta: "Add a contact" },
      { key: "communities", group: "communities", title: "Add your communities", ...later("communities", comms.length > 0),
        why: "Each community holds its homes, its own photos and its sales team.", detail: comms.length ? `${comms.length} ${comms.length === 1 ? "community" : "communities"}` : undefined,
        href: "/communities/new", cta: "Add a community" },
      { key: "community_setup", group: "communities", title: "Set up each community", ...later("communities", comms.length > 0 && commsReady === comms.length),
        why: "Schools, HOA, utilities, showing setup and driving directions. Answer once and every home in the community uses them.",
        detail: comms.length ? `${commsReady} of ${comms.length} ready for the MLS` : "Add a community first",
        href: commSetup.find((c) => c.filled < c.required) ? `/communities/${commSetup.find((c) => c.filled < c.required)!.id}/setup` : comms[0] ? `/communities/${comms[0].id}/setup` : "/communities/new",
        cta: "Set up" },
      { key: "sales", group: "communities", title: "Put salespeople on their communities", ...later("communities", unassigned === 0 && (sales.length === 0 || comms.length > 0)),
        why: "Salespeople only see the communities they’re on.",
        detail: sales.length === 0 ? "No salespeople yet" : unassigned ? `${unassigned} of ${sales.length} not on a community yet` : `All ${sales.length} assigned`,
        href: "/team", cta: "Assign" },
      { key: "plans", group: "homes", title: "Add your floor plans", ...later("plans", planCount > 0),
        why: "Upload each plan’s PDF and we read the room sizes for you to check, so every new home can start from its plan. Add photos of the model home too.", detail: planCount ? `${planCount} ${planCount === 1 ? "plan" : "plans"} set up` : undefined,
        href: "/plans", cta: "Add plans" },
      { key: "first_home", group: "homes", title: "Add your first home",
        why: "Start from a floor plan and only fill in what’s different: lot, price, build stage.",
        done: homeRows.length > 0, detail: homeRows.length ? `${homeRows.length} ${homeRows.length === 1 ? "home" : "homes"}` : undefined,
        href: "/homes/new", cta: "Add a home" },
    ];

    const done = steps.filter((s) => s.done).length;
    const ourDone = ourSteps.every((s) => s.done);
    const builderStarted = steps.some((s) => s.done);
    const stage: Stage = live > 0 ? "live"
      : approved > 0 ? "first_approved"
      : commsReady > 0 ? "community_ready"
      : builderStarted ? "setting_up"
      : owners > 0 && ourDone ? "invited"
      : "getting_ready";

    return {
      builderId: id,
      builderName: (b?.name ?? "").replace(" (demo)", ""),
      steps,
      ourSteps,
      communities: commSetup,
      done,
      total: steps.length,
      finishedAt: st.finished_at,
      stage,
    };
  });
}

// For the menu and the start page: is this builder's checklist still open?
// Owners, managers and marketing run it.
export async function setupOpen(supabase: SupabaseClient, role: string, builderId: string | null): Promise<boolean> {
  if (!builderId || !["builder_owner", "manager", "marketing"].includes(role)) return false;
  const { data } = await supabase.rpc("builder_setup_state", { p_builder: builderId });
  return !!data && !(data as { finished_at: string | null }).finished_at;
}

export function canRunSetup(role: string) {
  return ["platform_admin", "listing_coordinator", "builder_owner", "manager", "marketing"].includes(role);
}

// Who changes a community's setup answers (mirrors the community edit rule).
export function canEditCommunitySetup(role: string) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

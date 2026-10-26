"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canAddHomes, canRequestMedia, type Role } from "@/lib/permissions";
import { detectProvider } from "@/lib/listing-media";
import { answerSources, readMlsAnswers, storiesFromLevels } from "@/lib/ntreis-form";

const TEXT = ["unparsed_address", "city", "postal_code", "lot_number", "plan_name", "public_remarks", "build_stage", "estimated_completion"] as const;
const NUMBERS = ["list_price", "bedrooms_total", "bathrooms_full", "bathrooms_half", "living_area", "lot_size_acres", "stories", "garage_spaces", "year_built"] as const;

function fail(message: string): never {
  redirect(`/homes/new?${new URLSearchParams({ error: message }).toString()}`);
}

export async function createHome(formData: FormData) {
  const me = await requireProfile();
  if (!canAddHomes(me.role)) fail("Your role can’t add homes. Ask a manager or owner.");

  const supabase = await createClient();
  const communityId = String(formData.get("community_id") ?? "");
  // Reading the community through RLS proves the user can see it, and tells us its builder.
  const { data: community } = await supabase
    .from("communities")
    .select("id, builder_id, city")
    .eq("id", communityId)
    .maybeSingle();
  if (!community) fail("Pick a community for this home.");

  const row: Record<string, string | number | null> = {
    builder_id: community.builder_id,
    community_id: community.id,
    workflow_status: "draft",
  };
  const sources: Record<string, string> = {};

  for (const f of TEXT) {
    const v = String(formData.get(f) ?? "").trim();
    row[f] = v === "" ? null : v;
    if (v !== "") sources[f] = "staff";
  }
  for (const f of NUMBERS) {
    const raw = String(formData.get(f) ?? "").trim().replace(/[$,]/g, "");
    if (raw === "") {
      row[f] = null;
      continue;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) fail(`${f.replace(/_/g, " ")} must be a number.`);
    row[f] = n;
    sources[f] = "staff";
  }

  // The builder's NTREIS answers (only sent when the home is going to NTREIS).
  const answers = readMlsAnswers(formData);
  if (answers.badNumbers.length) fail(`${answers.badNumbers.join(", ")} must be a number.`);
  if (row.stories === null && storiesFromLevels(answers.values.Levels) !== null) {
    row.stories = storiesFromLevels(answers.values.Levels);
    sources.stories = "staff";
  }

  // Started from the builder's website: values that still match it are marked as
  // coming from the website (checked here against the website row, not trusted from the form).
  const websiteId = String(formData.get("website_listing_id") ?? "");
  const { data: web } = websiteId
    ? await supabase.from("website_listings").select("*").eq("id", websiteId).is("home_id", null).maybeSingle()
    : { data: null };
  const fromWebsite = !!web && web.builder_id === community.builder_id;
  if (fromWebsite) {
    for (const f of [...TEXT, ...NUMBERS]) {
      const w = (web as Record<string, unknown>)[f];
      if (w !== null && w !== undefined && row[f] !== null && String(w).trim() === String(row[f]).trim()) sources[f] = "website";
    }
    if (row.city === null && web.city) {
      row.city = web.city;
      sources.city = "website";
    }
  }

  if (!row.unparsed_address) fail("Enter the street address.");
  if (!row.city) row.city = community.city;
  if (!row.postal_code) fail("Enter the ZIP code.");
  if (!row.build_stage) row.build_stage = "under_construction";

  // Which MLS: blank means the database picks the community's MLS (by county).
  const board = String(formData.get("mls_board") ?? "");
  if (board && ["platform_admin", "listing_coordinator", "builder_owner", "manager"].includes(me.role)) {
    const { data: ok } = await supabase.from("mls_boards").select("code").eq("code", board).eq("active", true).maybeSingle();
    if (ok) row.mls_board = board;
  }

  const { data, error } = await supabase
    .from("homes")
    .insert({ ...row, mls_fields: answers.values, field_sources: { ...sources, ...answerSources(answers.changed) } })
    .select("id")
    .single();
  if (error || !data) {
    fail(error?.message.includes("row-level security") ? "You don’t have permission to add homes for that builder." : `Couldn’t save the home: ${error?.message}`);
  }

  // The website home is now in Builder Listings.
  if (fromWebsite) await supabase.from("website_listings").update({ home_id: data.id }).eq("id", web.id).is("home_id", null);

  // Photos, video and tours (the home has to exist first).
  const problems = await setUpListingMedia(supabase, data.id, community.id, me.role, formData);

  revalidatePath("/homes");
  revalidatePath("/approvals");
  revalidatePath("/media/requests");
  revalidatePath("/website-check");
  if (problems.length) redirect(`/homes/${data.id}?${new URLSearchParams({ error: `The home is saved, but: ${problems.join(" ")}`, at: "listing-media" })}#listing-media`);
  if (formData.get("photos_by") === "own") redirect(`/media/upload?home=${data.id}`);
  redirect(`/homes/${data.id}?saved=created`);
}

const NEEDS = new Set(["photos", "twilight", "video", "drone", "floor_plan", "virtual_tour"]);

// The Photos and tours step: tour links, the community's photos and video,
// and a request for our photographer. Returns anything that didn't work.
async function setUpListingMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  homeId: string,
  communityId: string,
  role: Role,
  formData: FormData,
) {
  const problems: string[] = [];

  const urls = formData.getAll("tour_url").map((u) => String(u).trim());
  const branded = formData.getAll("tour_branded").map(String);
  for (const [i, url] of urls.entries()) {
    if (!url) continue;
    if (!/^https:\/\/\S+$/i.test(url)) {
      problems.push(`The tour link "${url.slice(0, 60)}" needs to start with https://.`);
      continue;
    }
    const { error } = await supabase.from("virtual_tours").insert({
      home_id: homeId, community_id: communityId, provider: detectProvider(url), url, branded: branded[i] === "yes",
    });
    if (error) problems.push("A tour link couldn’t be saved.");
  }

  if (formData.get("include_community") === "1") {
    const { data: items } = await supabase
      .from("media")
      .select("id")
      .eq("community_id", communityId)
      .is("home_id", null)
      .in("kind", ["photo", "video"])
      .is("deleted_at", null)
      .order("kind")
      .order("sort_order");
    for (const m of items ?? []) {
      const { error } = await supabase.from("listing_media").insert({ home_id: homeId, media_id: m.id });
      if (error) {
        problems.push("The community’s photos couldn’t all be added.");
        break;
      }
    }
  }

  if (formData.get("photos_by") === "ours" && canRequestMedia(role)) {
    const needs = formData.getAll("needs").map(String).filter((n) => NEEDS.has(n));
    if (needs.length) {
      const notes = String(formData.get("shoot_notes") ?? "").trim();
      // Builder, address and names are filled in by the database from the home.
      const { error } = await supabase.from("media_requests").insert({
        home_id: homeId, community_id: communityId, builder_id: communityId, requested_by: communityId,
        address: "", community_name: "", builder_name: "", needs, notes: notes || null, due_date: null,
      });
      if (error) problems.push("The photographer request couldn’t be sent; request it from the home’s page.");
    }
  }
  return problems;
}

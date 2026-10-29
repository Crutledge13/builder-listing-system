"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { canEditCommunitySetup } from "@/lib/onboarding";
import { communitySections, MLS_BOARD_SELECT, type MlsBoard, type MlsField } from "@/lib/mls-fields";

function readOne(f: MlsField, formData: FormData): unknown {
  const name = `cf__${f.key}`;
  if (f.type === "multi") {
    const allowed = new Set(f.options ?? []);
    return [...new Set(formData.getAll(name).map(String))].filter((v) => allowed.has(v));
  }
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  if (f.type === "select" || f.type === "yesno") return (f.options ?? ["Yes", "No"]).includes(raw) ? raw : null;
  if (f.type === "number" || f.type === "money") {
    const n = Number(raw.replace(/[$,%]/g, ""));
    return Number.isNaN(n) || n < 0 ? undefined : n; // undefined = not a number
  }
  return raw.slice(0, 2000);
}

// Saves a community's basics and its shared MLS answers. Only fields that
// were on the form are touched. The database's community rules decide who
// can save (owners, managers and our admins).
export async function saveCommunitySetup(formData: FormData) {
  const id = String(formData.get("community_id"));
  const back = `/communities/${id}/setup`;
  const go = (p: Record<string, string>): never => redirect(`${back}?${new URLSearchParams(p).toString()}`);
  const me = await requireProfile();
  if (!canEditCommunitySetup(me)) go({ error: "Only an owner, marketing or a manager can change a community’s setup." });

  const supabase = await createClient();
  const { data: c } = await supabase.from("communities").select("id, name, mls_board, mls_fields").eq("id", id).maybeSingle();
  if (!c) return go({ error: "Community not found." });
  const { data: board } = c.mls_board
    ? await supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", c.mls_board).maybeSingle()
    : { data: null };
  const fields = new Map(communitySections(board as MlsBoard | null).flatMap((s) => s.fields).map((f) => [f.key, f]));

  const next: Record<string, unknown> = { ...((c.mls_fields ?? {}) as Record<string, unknown>) };
  const bad: string[] = [];
  for (const key of new Set(formData.getAll("cf_key").map(String))) {
    const f = fields.get(key);
    if (!f) continue;
    const v = readOne(f, formData);
    if (v === undefined) {
      bad.push(f.label);
      continue;
    }
    if (v === null || (Array.isArray(v) && v.length === 0)) delete next[key];
    else next[key] = v;
  }
  if (bad.length) go({ error: `These need a number: ${bad.join(", ")}.` });

  // Salespeople (MLS entry on) change only the MLS answers.
  const patch: Record<string, unknown> = { mls_fields: next };
  if (me.role !== "sales") {
    const name = String(formData.get("name") ?? "").trim();
    const city = String(formData.get("city") ?? "").trim();
    const county = String(formData.get("county") ?? "").trim();
    if (!name || !city) go({ error: "The community needs a name and city." });
    Object.assign(patch, { name, city, county: county || null });
  }

  const { data: saved, error } = await supabase
    .from("communities")
    .update(patch)
    .eq("id", id)
    .select("id");
  if (error) go({ error: error.message.includes("row-level security") ? "Your role can’t change this community." : `Couldn’t save: ${error.message}` });
  if (!saved?.length) go({ error: "Your role can’t change this community." });

  revalidatePath("/", "layout");
  go({ saved: "Community setup saved. Every home here uses these answers." });
}

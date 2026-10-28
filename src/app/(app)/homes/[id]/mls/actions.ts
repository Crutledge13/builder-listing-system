"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { enterOwnMls } from "@/lib/mls-entry";
import { isStaff } from "@/lib/permissions";
import { MLS_BOARD_SELECT, sectionsForBoard, type MlsBoard, type MlsField } from "@/lib/mls-fields";

function read(f: MlsField, formData: FormData): unknown {
  if (f.type === "multi") return formData.getAll(f.key).map(String).filter(Boolean);
  const raw = String(formData.get(f.key) ?? "").trim();
  if (raw === "") return null;
  if (f.type === "number" || f.type === "money") {
    const n = Number(raw.replace(/[$,%]/g, ""));
    return Number.isNaN(n) ? null : n;
  }
  return raw;
}

function merge(existing: Record<string, unknown>, fields: MlsField[], formData: FormData) {
  const next = { ...existing };
  for (const f of fields) {
    if (!formData.has(`present_${f.key}`)) continue; // field wasn't on the form
    const v = read(f, formData);
    if (v === null || (Array.isArray(v) && v.length === 0)) delete next[f.key];
    else next[f.key] = v;
  }
  return next;
}

// Our team saves the MLS-only fields: this home's own, and the community's shared ones.
export async function saveMlsSheet(formData: FormData) {
  const homeId = String(formData.get("home_id"));
  const back = String(formData.get("back") ?? `/homes/${homeId}/mls`);
  const go = (p: Record<string, string>): never => {
    const [path, hash] = back.split("#");
    redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(p).toString()}${hash ? `#${hash}` : ""}`);
  };
  const me = await requireProfile();
  if (!isStaff(me.role) && !(await enterOwnMls(me.role, me.builder_id))) go({ error: "Only our team fills in the MLS sheet." });

  const supabase = await createClient();
  const { data: home } = await supabase.from("homes").select("id, community_id, mls_board, communities(mls_fields)").eq("id", homeId).maybeSingle();
  if (!home) return go({ error: "Home not found." });
  const { data: rows } = await supabase.from("mls_details").select("id, home_id, community_id, data").or(`home_id.eq.${homeId},community_id.eq.${home.community_id}`);
  const homeRow = rows?.find((r) => r.home_id === homeId);
  const commRow = rows?.find((r) => r.community_id === home.community_id);

  // This MLS's own field list (including any extra fields it asks for).
  const { data: board } = home.mls_board
    ? await supabase.from("mls_boards").select(MLS_BOARD_SELECT).eq("code", home.mls_board).maybeSingle()
    : { data: null };
  const fields = sectionsForBoard(board as MlsBoard | null).flatMap((s) => s.fields);
  const homeData = merge((homeRow?.data ?? {}) as Record<string, unknown>, fields.filter((f) => f.source === "detail"), formData);
  const commFields = fields.filter((f) => f.source === "community");
  const commData = merge((commRow?.data ?? {}) as Record<string, unknown>, commFields, formData);
  // A shared value that matches the builder's community setup answer isn't
  // stored as ours, so it keeps following the builder if they change it.
  const answers = ((home.communities as unknown as { mls_fields: Record<string, unknown> } | null)?.mls_fields ?? {}) as Record<string, unknown>;
  for (const f of commFields) {
    if (formData.has(`present_${f.key}`) && f.key in answers && JSON.stringify(commData[f.key] ?? null) === JSON.stringify(answers[f.key])) delete commData[f.key];
  }

  const writes = [
    homeRow
      ? supabase.from("mls_details").update({ data: homeData }).eq("id", homeRow.id)
      : supabase.from("mls_details").insert({ home_id: homeId, data: homeData }), // builder filled in by the database
    commRow
      ? supabase.from("mls_details").update({ data: commData }).eq("id", commRow.id)
      : supabase.from("mls_details").insert({ community_id: home.community_id, data: commData }),
  ];
  for (const w of writes) {
    const { error } = await w;
    if (error) go({ error: error.message.includes("row-level security") ? "Only our team fills in the MLS sheet." : `Couldn’t save: ${error.message}` });
  }
  revalidatePath(`/homes/${homeId}`, "layout");
  revalidatePath("/tasks", "layout");
  go({ saved: "MLS sheet saved." });
}

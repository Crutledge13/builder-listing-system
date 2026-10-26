"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

// Managing the shared photo tag list. Admin only; the database enforces it too.

const CATEGORIES = new Set(["shot", "feature", "outdoor", "community"]);

function go(params: Record<string, string>, hash = ""): never {
  redirect(`/admin/tags?${new URLSearchParams(params).toString()}${hash}`);
}

async function admin() {
  const me = await requireProfile();
  if (me.role !== "platform_admin") go({ error: "Only platform admins can change the tag list." });
  return createClient();
}

function friendly(msg: string) {
  if (msg.includes("already used")) return "That name or alias is already used by another tag.";
  if (msg.includes("duplicate key")) return "There’s already a tag with that name.";
  if (msg.includes("row-level security")) return "Only platform admins can change the tag list.";
  return msg;
}

const aliasesFrom = (raw: FormDataEntryValue | null) =>
  String(raw ?? "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20);

export async function addTag(formData: FormData) {
  const supabase = await admin();
  const label = String(formData.get("label") ?? "").trim().slice(0, 40);
  const category = String(formData.get("category"));
  if (!label) go({ error: "Type the tag’s name." });
  const { error } = await supabase.from("media_tags").insert({
    label,
    category: CATEGORIES.has(category) ? category : "feature",
    aliases: aliasesFrom(formData.get("aliases")),
  });
  if (error) go({ error: friendly(error.message) });
  revalidatePath("/admin/tags");
  go({ saved: `Added “${label}”.` });
}

// Rename (every photo updates), change group and other names, retire or bring back.
export async function saveTag(formData: FormData) {
  const supabase = await admin();
  const id = String(formData.get("id"));
  const label = String(formData.get("label") ?? "").trim().slice(0, 40);
  const category = String(formData.get("category"));
  if (!label) go({ error: "A tag needs a name." });
  const { data: current } = await supabase.from("media_tags").select("label").eq("id", id).single();
  if (!current) go({ error: "That tag no longer exists." });

  const { error } = await supabase.from("media_tags").update({
    category: CATEGORIES.has(category) ? category : "feature",
    aliases: aliasesFrom(formData.get("aliases")),
    active: formData.get("active") === "on",
  }).eq("id", id);
  if (error) go({ error: friendly(error.message) });

  let moved = 0;
  if (label !== current.label) {
    const { data, error: renameError } = await supabase.rpc("rename_media_tag", { tag: id, new_label: label });
    if (renameError) go({ error: friendly(renameError.message) });
    moved = data ?? 0;
  }
  revalidatePath("/admin/tags");
  revalidatePath("/media");
  go({ saved: label !== current.label ? `Renamed to “${label}” on ${moved} ${moved === 1 ? "photo" : "photos"}. The old name still works when searching.` : `Saved “${label}”.` });
}

export async function mergeTag(formData: FormData) {
  const supabase = await admin();
  const from = String(formData.get("id"));
  const into = String(formData.get("into") ?? "");
  if (!into) go({ error: "Pick the tag to merge into." });
  const { data, error } = await supabase.rpc("merge_media_tags", { from_tag: from, into_tag: into });
  if (error) go({ error: friendly(error.message) });
  revalidatePath("/admin/tags");
  revalidatePath("/media");
  go({ saved: `Merged. ${data ?? 0} ${data === 1 ? "photo" : "photos"} moved over.` });
}

export async function approveTagRequest(formData: FormData) {
  const supabase = await admin();
  const id = String(formData.get("id"));
  const useTag = String(formData.get("use_tag") ?? "");
  const category = String(formData.get("category"));
  const { error } = await supabase.rpc("approve_media_tag_request", {
    request: id,
    use_tag: useTag || null,
    new_label: String(formData.get("label") ?? "").trim().slice(0, 40) || null,
    new_category: CATEGORIES.has(category) ? category : "feature",
    answer_text: useTag ? "Use the existing tag; your wording now finds it too." : String(formData.get("answer") ?? "").trim() || null,
  });
  if (error) go({ error: friendly(error.message) }, "#requests");
  revalidatePath("/admin/tags");
  go({ saved: useTag ? "Pointed to the existing tag." : "Added to the list." }, "#requests");
}

export async function rejectTagRequest(formData: FormData) {
  const supabase = await admin();
  const me = await requireProfile();
  const { error } = await supabase
    .from("media_tag_requests")
    .update({ status: "rejected", answer: String(formData.get("answer") ?? "").trim().slice(0, 500) || null, resolved_by: me.id, resolved_at: new Date().toISOString() })
    .eq("id", String(formData.get("id")))
    .eq("status", "pending");
  if (error) go({ error: friendly(error.message) }, "#requests");
  revalidatePath("/admin/tags");
  go({ saved: "Request declined." }, "#requests");
}

import type { SupabaseClient } from "@supabase/supabase-js";

// The shared photo tag list (media_tags). Extra tags must come from here; the
// database drops anything else. Address, plan, community and room tags are
// added automatically and aren't on this list.

export type TagCategory = "shot" | "feature" | "outdoor" | "community";
export type ListTag = { id: string; label: string; category: TagCategory; aliases: string[]; active: boolean; sort: number };

export const TAG_CATEGORIES: { key: TagCategory; label: string }[] = [
  { key: "shot", label: "Type of shot" },
  { key: "feature", label: "Inside the home" },
  { key: "outdoor", label: "Outside the home" },
  { key: "community", label: "Community" },
];

export async function loadTagList(supabase: SupabaseClient, opts: { includeRetired?: boolean } = {}): Promise<ListTag[]> {
  let q = supabase.from("media_tags").select("id, label, category, aliases, active, sort").order("sort").order("label");
  if (!opts.includeRetired) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as ListTag[];
}

// Which of a photo's tags are picked from the list (the rest were added automatically).
export function pickedTags(tags: string[], list: ListTag[]) {
  const labels = new Map(list.map((t) => [t.label.toLowerCase(), t.label]));
  return tags.filter((t) => labels.has(t.toLowerCase())).map((t) => labels.get(t.toLowerCase())!);
}

// Map free text (from the AI) to list labels; anything not on the list is dropped.
export function matchToList(words: string[], list: ListTag[]) {
  const index = new Map<string, string>();
  for (const t of list) {
    index.set(t.label.toLowerCase(), t.label);
    t.aliases.forEach((a) => index.set(a.toLowerCase(), t.label));
  }
  return [...new Set(words.map((w) => index.get(w.toLowerCase().trim())).filter((x): x is string => !!x))];
}

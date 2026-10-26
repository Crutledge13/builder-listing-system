"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

function back(params: Record<string, string>): never {
  redirect(`/communities/new?${new URLSearchParams(params).toString()}`);
}

// Our admins pick the builder; builder owners and managers add to their own.
export async function createCommunity(formData: FormData) {
  const me = await requireProfile();
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const county = String(formData.get("county") ?? "").trim();
  const builderId = me.role === "platform_admin" ? String(formData.get("builder_id") ?? "") : me.builder_id;
  if (!name || !city) back({ error: "Enter the community name and city." });
  if (!builderId) back({ error: "Pick the builder." });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communities")
    .insert({ name, city, county: county || null, builder_id: builderId })
    .select("id")
    .single();
  if (error || !data) back({ error: error?.message.includes("row-level security") ? "Your role can’t add communities." : "Couldn’t add that community." });
  revalidatePath("/", "layout");
  redirect(`/communities/${data.id}?saved=${encodeURIComponent(`Added ${name}. Add its homes and assign your sales team below.`)}`);
}

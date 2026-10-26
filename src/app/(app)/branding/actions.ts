"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const HEX = /^#[0-9a-fA-F]{6}$/;

function go(builderId: string, params: Record<string, string>): never {
  redirect(`/branding?${new URLSearchParams({ builder: builderId, ...params }).toString()}`);
}

export async function saveBranding(formData: FormData) {
  await requireProfile();
  const builderId = String(formData.get("builder_id"));
  const color = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return HEX.test(v) ? v.toLowerCase() : null;
  };
  let website = String(formData.get("website_url") ?? "").trim();
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  if (website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website)) go(builderId, { error: "That website address doesn’t look right." });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("builder_branding")
    .update({
      primary_color: formData.get("use_primary") === "on" ? color("primary_color") : null,
      secondary_color: formData.get("use_secondary") === "on" ? color("secondary_color") : null,
      website_url: website || null,
      tagline: String(formData.get("tagline") ?? "").trim().slice(0, 120) || null,
      brand_notes: String(formData.get("brand_notes") ?? "").trim().slice(0, 2000) || null,
    })
    .eq("builder_id", builderId)
    .select("builder_id");
  if (error) go(builderId, { error: `Couldn’t save: ${error.message}` });
  if (!data?.length) go(builderId, { error: "Your role can’t change this builder’s branding." });
  revalidatePath("/", "layout");
  go(builderId, { saved: "Branding saved." });
}

async function setLogo(builderId: string, path: string | null): Promise<{ error?: string }> {
  await requireProfile();
  const supabase = await createClient();
  const { data: before } = await supabase.from("builder_branding").select("logo_path").eq("builder_id", builderId).maybeSingle();
  const { data, error } = await supabase.from("builder_branding").update({ logo_path: path }).eq("builder_id", builderId).select("builder_id");
  if (error || !data?.length) return { error: "Your role can’t change this builder’s logo." };
  if (before?.logo_path && before.logo_path !== path) await supabase.storage.from("branding").remove([before.logo_path]);
  revalidatePath("/", "layout");
  return {};
}

export async function saveLogo(builderId: string, path: string) {
  return setLogo(builderId, path);
}

export async function removeLogo(builderId: string) {
  return setLogo(builderId, null);
}

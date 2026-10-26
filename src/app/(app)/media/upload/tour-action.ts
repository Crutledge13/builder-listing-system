"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { detectProvider } from "@/lib/listing-media";

// A photographer hands over a 3D or video tour link for their job. The
// database only accepts it for homes or communities on their open jobs, and
// a home's tour goes straight onto its MLS listing.
export async function addJobTour(formData: FormData) {
  await requireProfile();
  const requestId = String(formData.get("request") ?? "");
  const backTo = (p: Record<string, string>): never => redirect(`/media/upload?${new URLSearchParams({ request: requestId, ...p })}#tour`);
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) backTo({ tour_error: "Paste the full tour link, starting with https://" });

  const supabase = await createClient();
  const { data: job } = await supabase.from("media_requests").select("home_id, community_id").eq("id", requestId).maybeSingle();
  if (!job) return backTo({ tour_error: "That job isn’t open for you any more." });
  const { error } = await supabase.from("virtual_tours").insert({
    home_id: job.home_id,
    community_id: job.community_id,
    provider: detectProvider(url),
    url,
    branded: formData.get("branded") === "yes",
    title: String(formData.get("title") ?? "").trim().slice(0, 120) || null,
  });
  if (error) backTo({ tour_error: error.message.includes("row-level security") ? "You can only add tours for your open jobs." : "Couldn’t save the tour link." });
  revalidatePath("/jobs");
  backTo({ tour_saved: "1" });
}

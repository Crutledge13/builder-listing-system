"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { safePath } from "@/lib/safe-path";

// Approve our photographer's files (they go on the listing for the MLS) or set
// them aside ("Don't use"). public.review_media does it as the signed-in person;
// the database lets only the owner, managers, marketing and our admins.
export async function reviewPhotos(formData: FormData) {
  await requireProfile();
  const back = safePath(String(formData.get("back") ?? ""), "/media");
  const go = (params: Record<string, string>): never => {
    const [path, hash] = back.split("#");
    redirect(`${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(params)}${hash ? `#${hash}` : ""}`);
  };
  const all = formData.getAll("media_id").map(String);
  const approve = new Set(formData.getAll("approve").map(String));
  const everything = formData.get("decision") === "all";
  const yes = everything ? all : all.filter((id) => approve.has(id));
  const no = everything ? [] : all.filter((id) => !approve.has(id));
  if (!all.length) go({ error: "Nothing to review." });

  const supabase = await createClient();
  let approved = 0;
  let setAside = 0;
  if (yes.length) {
    const { data, error } = await supabase.rpc("review_media", { p_ids: yes, p_decision: "approved" });
    if (error) go({ error: error.message });
    approved = Number(data ?? 0);
  }
  if (no.length) {
    const { data, error } = await supabase.rpc("review_media", { p_ids: no, p_decision: "not_used" });
    if (error) go({ error: error.message });
    setAside = Number(data ?? 0);
  }
  if (!approved && !setAside) go({ error: "Nothing changed. Marketing, managers and the owner approve the photographer’s photos." });
  revalidatePath("/", "layout");
  go({
    saved: [
      approved ? `Approved ${approved} ${approved === 1 ? "file" : "files"}: they’re on the listing for the MLS now.` : "",
      setAside ? `${setAside} set aside (not used). They stay in the media library.` : "",
    ].filter(Boolean).join(" "),
  });
}

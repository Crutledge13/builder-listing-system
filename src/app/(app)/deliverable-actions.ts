"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import type { DeliverableTable } from "@/lib/deliverables";

// Our team: record a file just uploaded to the deliverables bucket for a request.
export async function saveDeliverable(table: DeliverableTable, requestId: string, revalidate: string, path: string, fileName: string): Promise<{ error?: string }> {
  const me = await requireProfile();
  if (!isStaff(me.role)) return { error: "Only our team delivers files." };
  const supabase = await createClient();
  const { error } = await supabase.from("deliverable_files").insert({
    request_table: table,
    request_id: requestId,
    storage_path: path,
    file_name: fileName.slice(0, 200),
    builder_id: path.split("/")[0],
  });
  if (error) {
    await supabase.storage.from("deliverables").remove([path]);
    return { error: "Couldn’t attach that file." };
  }
  revalidatePath(revalidate);
  return {};
}

// Our team: take a delivered file back off (kept in the trash, not deleted).
export async function trashDeliverable(formData: FormData) {
  const me = await requireProfile();
  if (!isStaff(me.role)) return;
  const supabase = await createClient();
  await supabase.from("deliverable_files").update({ deleted_at: new Date().toISOString() }).eq("id", String(formData.get("file_id")));
  revalidatePath(String(formData.get("back") ?? "/"));
}

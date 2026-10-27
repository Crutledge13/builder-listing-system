import type { SupabaseClient } from "@supabase/supabase-js";

// Files our team delivers back for a request (reverse prospecting lists, comps).
export type DeliverableFile = { id: string; request_id: string; file_name: string; size_bytes: number | null; created_at: string };
export type DeliverableTable = "reverse_prospect_requests" | "comp_requests";

export const DELIVERABLE_TYPES =
  "application/pdf,text/csv,text/plain,application/zip,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp";

export async function loadDeliverables(supabase: SupabaseClient, table: DeliverableTable, ids: string[]) {
  if (!ids.length) return new Map<string, DeliverableFile[]>();
  const { data } = await supabase
    .from("deliverable_files")
    .select("id, request_id, file_name, size_bytes, created_at")
    .eq("request_table", table)
    .in("request_id", ids)
    .is("deleted_at", null)
    .order("created_at");
  const out = new Map<string, DeliverableFile[]>();
  for (const f of (data ?? []) as DeliverableFile[]) out.set(f.request_id, [...(out.get(f.request_id) ?? []), f]);
  return out;
}

export const fileSize = (b: number | null) => (b == null ? "" : b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

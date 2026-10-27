import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

// Some builders use the software on their own and enter listings in the MLS
// themselves (Admin > Builders: "Who enters listings in the MLS"). Their owners,
// managers and marketing then get the MLS work our team would get: the work
// sheets, the MLS sheet and the notices. The database enforces the same rule
// (private.can_work_mls).
export const enterOwnMls = cache(async (role: Role, builderId: string | null): Promise<boolean> => {
  if (!builderId || !["builder_owner", "manager", "marketing"].includes(role)) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("builder_settings").select("mls_entry").eq("builder_id", builderId).maybeSingle();
  return data?.mls_entry === "builder";
});

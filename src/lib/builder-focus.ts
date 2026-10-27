import "server-only";
import { cookies } from "next/headers";
import { isStaff, type Role } from "@/lib/permissions";

// Our team can narrow every list to one builder (the picker in the top bar).
// Saved in a cookie, so it sticks while moving between pages. It's only a view
// filter: what anyone may see is still decided by the database.
export const FOCUS_COOKIE = "builder_focus";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function builderFocus(role: Role): Promise<string | null> {
  if (!isStaff(role)) return null;
  const v = (await cookies()).get(FOCUS_COOKIE)?.value ?? "";
  return UUID.test(v) ? v : null;
}

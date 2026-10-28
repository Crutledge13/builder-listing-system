"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { FOCUS_COOKIE } from "@/lib/builder-focus";
import { safePath } from "@/lib/safe-path";

// Our team: show one builder everywhere, or all of them.
export async function setBuilderFocus(formData: FormData) {
  const me = await requireProfile();
  const id = String(formData.get("builder") ?? "");
  const jar = await cookies();
  if (isStaff(me.role) && id) jar.set(FOCUS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
  else jar.delete(FOCUS_COOKIE);
  // Back to the same page, without a builder= left over from a page's own picker.
  const ref = (await headers()).get("referer");
  let to = "/tasks";
  if (ref) {
    const u = new URL(ref);
    u.searchParams.delete("builder");
    to = `${u.pathname}${u.search}`;
  }
  redirect(safePath(to, "/tasks"));
}

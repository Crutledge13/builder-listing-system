import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/permissions";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  builder_id: string | null;
  builder_name: string | null;
};

// The signed-in user's profile, or a redirect to /login.
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, builder_id, builders(name)")
    .eq("id", user.id)
    .single();

  if (!data) redirect("/login?error=no-profile");

  const builder = data.builders as unknown as { name: string } | null;
  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    role: data.role as Role,
    builder_id: data.builder_id,
    builder_name: builder?.name ?? null,
  };
}

// Fake logins used for demos. Only switchable when DEMO_MODE is on.
export const DEMO_USERS = [
  { email: "admin@demo.test", label: "Dana Admin", detail: "Platform admin (our staff)" },
  { email: "coordinator@demo.test", label: "Casey Coordinator", detail: "Listing coordinator (our staff)" },
  { email: "owner.mesquite@demo.test", label: "Morgan Reyes", detail: "Owner, Mesquite Creek" },
  { email: "manager.mesquite@demo.test", label: "Jordan Ellis", detail: "Manager, Mesquite Creek" },
  { email: "sales.mesquite@demo.test", label: "Taylor Brooks", detail: "Sales, Mesquite Creek" },
  { email: "marketing.mesquite@demo.test", label: "Riley Chen", detail: "Marketing, Mesquite Creek" },
  { email: "owner.prairie@demo.test", label: "Avery Patel", detail: "Owner, Prairie Lantern" },
  { email: "marketing.prairie@demo.test", label: "Quinn Harper", detail: "Marketing, Prairie Lantern" },
] as const;

export function demoModeOn() {
  return process.env.DEMO_MODE === "true" && !!process.env.DEMO_PASSWORD;
}

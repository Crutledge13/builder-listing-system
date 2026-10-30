import { cookies } from "next/headers";

// Cards or list on Homes and Communities (set by ViewToggle).
export async function viewPref(name: "homes" | "communities"): Promise<"cards" | "list"> {
  const v = (await cookies()).get(`${name}_view`)?.value;
  return v === "list" ? "list" : "cards";
}

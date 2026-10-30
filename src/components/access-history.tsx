import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { dateTime } from "@/lib/format";

type Entry = { id: number; actor_id: string | null; action: string; changes: Record<string, string | null>; created_at: string };

const role = (r: string | null) => (r ? ROLE_LABELS[r as Role] ?? r : "none");

function describe(e: Entry) {
  const c = e.changes;
  switch (e.action) {
    case "person_added": return c.via ? `let ${c.name} (${c.email}) join as ${role(c.role)} with a join link${c.link ? ` (“${c.link}”)` : ""}` : `added ${c.name} (${c.email}) as ${role(c.role)}`;
    case "person_role_changed": return `changed ${c.name} from ${role(c.from)} to ${role(c.to)}`;
    case "person_company_changed": return `moved ${c.name} to a different company`;
    case "person_turned_off": return `turned off ${c.name}’s access`;
    case "person_turned_on": return `turned ${c.name}’s access back on`;
    case "sales_community_added": return `gave ${c.name} access to ${c.community}`;
    case "sales_community_removed": return `removed ${c.name} from ${c.community}`;
    case "person_staff_builder_added": return `assigned ${c.person} (our team) to work on this builder`;
    case "person_staff_builder_removed": return `took ${c.person} (our team) off this builder`;
    case "person_broker_added": return `added ${c.name} (${c.email}) as the outside listing broker`;
    case "person_broker_removed": return `removed ${c.name} as the outside listing broker`;
    default: return e.action.replace(/_/g, " ");
  }
}

// Who gave whom access, and when. The database decides what each viewer may see:
// builder owners and managers their own company, our staff everything.
export async function AccessHistory({ limit = 30 }: { limit?: number }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activity_log")
    .select("id, actor_id, action, changes, created_at")
    .or("action.like.person_*,action.like.sales_community_*")
    .order("created_at", { ascending: false })
    .limit(limit);
  const entries = (data ?? []) as Entry[];
  const ids = [...new Set(entries.map((e) => e.actor_id).filter((x): x is string => !!x))];
  const { data: actors } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const name = new Map((actors ?? []).map((a) => [a.id, a.full_name]));
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Access history</h2>
      <p className="mt-1 text-sm text-muted">Every time someone is added, changes role, gets a community, or has access turned off.</p>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {entries.map((e) => (
          <li key={e.id} className="px-4 py-2.5 text-sm">
            <span className="font-medium">{e.actor_id ? name.get(e.actor_id) ?? "Someone" : "System"}</span> {describe(e)}
            <span className="ml-2 text-muted">{dateTime(e.created_at)}</span>
          </li>
        ))}
        {entries.length === 0 && <li className="px-4 py-4 text-sm text-muted">No access changes yet.</li>}
      </ul>
    </section>
  );
}

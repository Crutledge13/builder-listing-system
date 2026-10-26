import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { resolveFromInbox } from "@/app/(app)/admin/actions";

// Open change requests across every home the viewer can see.
export async function RequestsInbox({ back, showBuilder, canResolve }: { back: string; showBuilder: boolean; canResolve: boolean }) {
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("change_requests")
    .select("id, message, created_at, requested_by, home_id, homes(unparsed_address, city, communities(name)), builders(name)")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const ids = [...new Set((requests ?? []).map((r) => r.requested_by))];
  const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  if (!requests?.length) {
    return <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-muted">No open change requests.</p>;
  }

  return (
    <ul className="space-y-3">
      {requests.map((r) => {
        const home = r.homes as unknown as { unparsed_address: string; city: string; communities: { name: string } | null } | null;
        return (
          <li key={r.id} className="rounded-2xl border border-amber-300 bg-amber-50/50 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/homes/${r.home_id}#requests`} className="font-semibold underline">
                {home?.unparsed_address}, {home?.city}
              </Link>
              <span className="text-sm text-muted">
                {home?.communities?.name}
                {showBuilder ? `, ${(r.builders as unknown as { name: string })?.name.replace(" (demo)", "")}` : ""}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-line">{r.message}</p>
            <p className="mt-1 text-sm text-muted">{nameOf.get(r.requested_by) ?? "Someone"}, {dateTime(r.created_at)}</p>
            {canResolve && (
              <form action={resolveFromInbox} className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="request_id" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <input name="note" placeholder="Note (optional)" className="field-input max-w-xs flex-1 py-2 text-sm" />
                <button name="status" value="done" className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Mark done</button>
                <button name="status" value="declined" className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-white">Decline</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}

import { Suspense } from "react";
import { isPlatformAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Notice } from "@/components/notice";
import { RequestsInbox } from "@/components/requests-inbox";
import { dateTime } from "@/lib/format";
import { closeIssue } from "../actions";

export default function RequestsAdmin(props: PageProps<"/admin/requests">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <HelpReports />
      <h2 className="mb-2 mt-10 text-lg font-semibold">Change requests</h2>
      <p className="mb-4 text-muted">Every open change request across all builders, oldest first. Fix the home, then mark the request done.</p>
      <RequestsInbox back="/admin/requests" showBuilder canResolve />
    </Suspense>
  );
}

async function HelpReports() {
  if (!(await isPlatformAdmin())) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("issue_reports").select("id, reporter_name, reporter_role, kind, page, message, created_at").eq("status", "open").order("created_at");
  return (
    <section>
      <h2 className="text-lg font-semibold">Help and issue reports</h2>
      <p className="mt-1 text-muted">From the Help page. Each one is also on the task board.</p>
      <div className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {(data ?? []).map((r) => (
          <div key={r.id} className="flex flex-wrap items-start gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line">{r.message}</p>
              <p className="mt-1 text-sm text-muted">
                {r.reporter_name ?? "Someone"} ({r.reporter_role?.replace(/_/g, " ")}), {dateTime(r.created_at)}{r.page ? `. Page: ${r.page}` : ""}
              </p>
            </div>
            <form action={closeIssue}>
              <input type="hidden" name="id" value={r.id} />
              <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:border-foreground">Close</button>
            </form>
          </div>
        ))}
        {!data?.length && <p className="p-4 text-sm text-muted">No open reports.</p>}
      </div>
    </section>
  );
}

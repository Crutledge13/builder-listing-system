import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { isStaff, type Role, type WorkflowStatus } from "@/lib/permissions";
import { money } from "@/lib/format";
import { StatusBadge } from "@/components/badges";
import { HomeArt } from "@/components/home-art";
import { RequestsInbox } from "@/components/requests-inbox";
import { Notice } from "@/components/notice";

export default function ApprovalsPage(props: PageProps<"/approvals">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Notice searchParams={props.searchParams} />
      <Queues />
    </Suspense>
  );
}

type Queue = { title: string; hint: string; statuses: WorkflowStatus[] };

function queuesFor(role: Role): Queue[] {
  const review: Queue = {
    title: "Waiting for approval",
    hint: "Submitted by the builder team. A manager or owner approves them for the MLS.",
    statuses: ["in_review"],
  };
  const mls: Queue = {
    title: "Ready to enter into the MLS",
    hint: "Approved by the builder. Enter each one into the MLS, then log the MLS number.",
    statuses: ["approved_for_mls"],
  };
  const drafts: Queue = {
    title: "Drafts",
    hint: "Not submitted yet. Finish the details and submit for review.",
    statuses: ["draft"],
  };
  switch (role) {
    case "platform_admin": return [review, mls, drafts];
    case "listing_coordinator": return [mls, review];
    case "builder_owner":
    case "manager": return [review, drafts, { ...mls, title: "Approved, waiting on the MLS", hint: "Our listing coordinator is entering these into the MLS." }];
    default: return [drafts, { ...review, hint: "Waiting for a manager or owner to approve." }];
  }
}

async function Queues() {
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const supabase = await createClient();
  const { data: homes } = await supabase
    .from("homes")
    .select("id, unparsed_address, city, plan_name, list_price, stories, workflow_status, updated_at, communities(name), builders(name)")
    .is("deleted_at", null)
    .in("workflow_status", ["draft", "in_review", "approved_for_mls"])
    .order("updated_at", { ascending: true });

  return (
    <div className="max-w-4xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Approvals</h1>
      <p className="mt-1 text-muted">Every listing moves from draft, to review, to ready for the MLS, to live.</p>

      <div className="mt-8 space-y-12">
        {["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role) && (
          <section>
            <h2 className="text-[22px] font-semibold">Change requests</h2>
            <p className="mt-1 text-muted">Things your team asked to fix. Make the change on the home, then mark it done.</p>
            <div className="mt-4">
              <RequestsInbox back="/approvals" showBuilder={isStaff(me.role)} canResolve />
            </div>
          </section>
        )}
        {queuesFor(me.role).map((q) => {
          const rows = (homes ?? []).filter((h) => q.statuses.includes(h.workflow_status));
          return (
            <section key={q.title}>
              <h2 className="text-[22px] font-semibold">
                {q.title} <span className="font-normal text-muted">{rows.length}</span>
              </h2>
              <p className="mt-1 text-muted">{q.hint}</p>
              <div className="mt-4 space-y-3">
                {rows.map((h) => (
                  <Link
                    key={h.id}
                    href={`/homes/${h.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-line p-3 transition-shadow hover:shadow-md"
                  >
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl sm:h-20 sm:w-28">
                      <HomeArt seed={h.id} stories={h.stories} className="h-full w-full" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{h.unparsed_address}, {h.city}</div>
                      <div className="truncate text-sm text-muted">
                        {h.plan_name} plan in {(h.communities as unknown as { name: string })?.name}
                        {isStaff(me.role) ? `, ${(h.builders as unknown as { name: string })?.name.replace(" (demo)", "")}` : ""}
                      </div>
                      <div className="mt-1 font-semibold tabular-nums sm:hidden">{money(h.list_price)}</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="font-semibold tabular-nums">{money(h.list_price)}</div>
                      <div className="mt-1"><StatusBadge status={h.workflow_status} /></div>
                    </div>
                  </Link>
                ))}
                {rows.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-muted">Nothing waiting here.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

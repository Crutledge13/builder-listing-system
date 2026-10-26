import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff, type Role, type WorkflowStatus } from "@/lib/permissions";
import { money } from "@/lib/format";
import { StatusBadge } from "@/components/badges";

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
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
  const supabase = await createClient();
  const { data: homes } = await supabase
    .from("homes")
    .select("id, unparsed_address, plan_name, list_price, workflow_status, updated_at, communities(name), builders(name)")
    .is("deleted_at", null)
    .in("workflow_status", ["draft", "in_review", "approved_for_mls"])
    .order("updated_at", { ascending: true });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="mt-1 text-sm text-muted">Listings move from draft, to review, to ready for MLS, to live.</p>

      <div className="mt-6 space-y-8">
        {queuesFor(me.role).map((q) => {
          const rows = (homes ?? []).filter((h) => q.statuses.includes(h.workflow_status));
          return (
            <section key={q.title}>
              <div className="flex items-baseline gap-2">
                <h2 className="font-semibold">{q.title}</h2>
                <span className="text-sm text-muted">{rows.length}</span>
              </div>
              <p className="text-sm text-muted">{q.hint}</p>
              <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
                {rows.map((h) => (
                  <Link key={h.id} href={`/homes/${h.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-background">
                    <span className="font-medium">{h.unparsed_address}</span>
                    <span className="text-muted">
                      {(h.communities as unknown as { name: string })?.name} · {h.plan_name}
                      {isStaff(me.role) ? ` · ${(h.builders as unknown as { name: string })?.name.replace(" (demo)", "")}` : ""}
                    </span>
                    <span className="ml-auto tabular-nums">{money(h.list_price)}</span>
                    <StatusBadge status={h.workflow_status} />
                  </Link>
                ))}
                {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">Nothing here right now.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  allowedTransitions,
  editableFields,
  isStaff,
  ROLE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
  TRANSITION_LABELS,
  type HomeField,
  type WorkflowStatus,
} from "@/lib/permissions";
import { cx, dateTime, money } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/badges";
import { changeStatus, saveHome } from "./actions";

export default function HomePage(props: PageProps<"/homes/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <HomeDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

type FieldDef = {
  name: HomeField;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "stage";
  step?: string;
  wide?: boolean;
};

const SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Location",
    fields: [
      { name: "unparsed_address", label: "Street address", wide: true },
      { name: "city", label: "City" },
      { name: "postal_code", label: "ZIP" },
      { name: "lot_number", label: "Lot / block" },
      { name: "plan_name", label: "Floor plan" },
    ],
  },
  {
    title: "Price and specs",
    fields: [
      { name: "list_price", label: "List price ($)", type: "number", step: "1" },
      { name: "bedrooms_total", label: "Bedrooms", type: "number" },
      { name: "bathrooms_full", label: "Full baths", type: "number" },
      { name: "bathrooms_half", label: "Half baths", type: "number" },
      { name: "living_area", label: "Living area (sq ft)", type: "number" },
      { name: "lot_size_acres", label: "Lot size (acres)", type: "number", step: "0.001" },
      { name: "stories", label: "Stories", type: "number" },
      { name: "garage_spaces", label: "Garage spaces", type: "number" },
      { name: "year_built", label: "Year built", type: "number" },
    ],
  },
  {
    title: "Construction",
    fields: [
      { name: "build_stage", label: "Build stage", type: "stage" },
      { name: "estimated_completion", label: "Estimated completion", type: "date" },
    ],
  },
  {
    title: "Listing description",
    fields: [{ name: "public_remarks", label: "Description (MLS public remarks)", type: "textarea", wide: true }],
  },
];

async function HomeDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/homes/[id]">["params"];
  searchParams: PageProps<"/homes/[id]">["searchParams"];
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireProfile();
  const supabase = await createClient();

  const { data: home } = await supabase
    .from("homes")
    .select("*, communities(name), builders(name)")
    .eq("id", id)
    .maybeSingle();
  // RLS hides other builders' homes, so they look exactly like missing ones.
  if (!home) notFound();

  const { data: activity } = await supabase
    .from("activity_log")
    .select("id, action, changes, actor_id, created_at")
    .eq("home_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const actorIds = [...new Set((activity ?? []).map((a) => a.actor_id).filter(Boolean))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, role").in("id", actorIds)
    : { data: [] as { id: string; full_name: string; role: string }[] };
  const actorName = new Map((actors ?? []).map((a) => [a.id, a.full_name]));

  const editable = new Set(editableFields(me.role));
  const status = home.workflow_status as WorkflowStatus;
  const transitions = allowedTransitions(me.role, status);
  const sources = (home.field_sources ?? {}) as Record<string, string>;
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = typeof sp.saved === "string" ? sp.saved : null;

  return (
    <div>
      <Link href="/homes" className="text-sm text-muted hover:text-foreground">← All homes</Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{home.unparsed_address}</h1>
          <p className="mt-1 text-sm text-muted">
            {home.communities?.name} · {home.city}, TX {home.postal_code}
            {isStaff(me.role) ? ` · ${home.builders?.name}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{money(home.list_price)}</div>
          <div className="mt-1"><StatusBadge status={status} /></div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {saved === "status" ? "Status updated." : "Changes saved."}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <form action={saveHome} className="space-y-6">
          <input type="hidden" name="id" value={home.id} />
          {SECTIONS.map((section) => (
            <section key={section.title} className="rounded-xl border border-line bg-surface p-5">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {section.fields.map((f) => (
                  <Field key={f.name} def={f} value={home[f.name]} source={sources[f.name]} canEdit={editable.has(f.name)} />
                ))}
              </div>
            </section>
          ))}
          {editable.size > 0 ? (
            <div className="flex items-center gap-3">
              <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">Save changes</button>
              <span className="text-xs text-muted">
                As {ROLE_LABELS[me.role]}, you can edit the fields that aren’t grayed out.
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted">As {ROLE_LABELS[me.role]}, you can view these details but not edit them.</p>
          )}
        </form>

        <aside className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Approval</h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {(Object.keys(STATUS_LABELS) as WorkflowStatus[]).map((s, i, all) => {
                const done = all.indexOf(status) >= i;
                return (
                  <li key={s} className={cx("flex items-center gap-2", done ? "text-foreground" : "text-muted")}>
                    <span className={cx("h-2 w-2 rounded-full", done ? "bg-accent" : "bg-line")} />
                    {STATUS_LABELS[s]}
                  </li>
                );
              })}
            </ol>
            {home.mls_number && (
              <p className="mt-3 text-sm">MLS number: <span className="font-medium">{home.mls_number}</span></p>
            )}

            {transitions.length > 0 ? (
              <div className="mt-4 space-y-2">
                {transitions.map((to) => (
                  <form key={to} action={changeStatus} className="space-y-2">
                    <input type="hidden" name="id" value={home.id} />
                    <input type="hidden" name="from" value={status} />
                    <input type="hidden" name="to" value={to} />
                    {to === "live_on_mls" && (
                      <input name="mls_number" placeholder="MLS number from the MLS" required className="field-input" />
                    )}
                    <button
                      className={cx(
                        "w-full rounded-lg px-3 py-2 text-sm font-medium",
                        to === "draft" || (status === "approved_for_mls" && to === "in_review")
                          ? "border border-line hover:bg-background"
                          : "bg-accent text-white hover:opacity-90",
                      )}
                    >
                      {status === "approved_for_mls" && to === "in_review" ? "Send back for changes" : TRANSITION_LABELS[to]}
                    </button>
                  </form>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-xs text-muted">{nextStepHint(status)}</p>
            )}
          </section>

          <section className="rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold">Activity</h2>
            <ul className="mt-3 space-y-3">
              {activity?.map((a) => (
                <li key={a.id} className="text-sm">
                  <div>
                    <span className="font-medium">{a.actor_id ? (actorName.get(a.actor_id) ?? "Someone") : "System import"}</span>{" "}
                    <span className="text-muted">{describe(a.action, a.changes as Record<string, { from: unknown; to: unknown }>)}</span>
                  </div>
                  <div className="text-xs text-muted">{dateTime(a.created_at)}</div>
                </li>
              ))}
              {!activity?.length && <li className="text-sm text-muted">No activity yet.</li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Field({ def, value, source, canEdit }: { def: FieldDef; value: unknown; source?: string; canEdit: boolean }) {
  const v = value === null || value === undefined ? "" : String(value);
  const common = { name: def.name, disabled: !canEdit, className: "field-input", defaultValue: v };
  return (
    <label className={cx("block text-sm", def.wide && "sm:col-span-2 lg:col-span-3")}>
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
        {def.label} <SourceBadge source={source} />
      </span>
      {def.type === "textarea" ? (
        <textarea {...common} rows={5} />
      ) : def.type === "stage" ? (
        <select {...common}>
          {Object.entries(STAGE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
      ) : (
        <input {...common} type={def.type ?? "text"} step={def.step} />
      )}
    </label>
  );
}

function nextStepHint(status: WorkflowStatus) {
  switch (status) {
    case "draft": return "Waiting for the builder team to submit this for review.";
    case "in_review": return "Waiting for a builder manager or owner to approve it for the MLS.";
    case "approved_for_mls": return "Approved. Our listing coordinator will enter it into the MLS.";
    case "live_on_mls": return "This listing is live on the MLS.";
  }
}

const FIELD_NAMES: Record<string, string> = {
  list_price: "price", public_remarks: "description", build_stage: "build stage",
  living_area: "square feet", bedrooms_total: "bedrooms", mls_number: "MLS number",
  estimated_completion: "completion date", unparsed_address: "address",
};

function describe(action: string, changes: Record<string, { from: unknown; to: unknown }>) {
  if (action === "created") return "added this home";
  if (action.startsWith("status_")) {
    const s = action.replace("status_", "") as WorkflowStatus;
    return `moved it to ${STATUS_LABELS[s] ?? s}`;
  }
  if (action === "moved_to_trash") return "moved it to the trash";
  if (action === "restored") return "restored it from the trash";
  const keys = Object.keys(changes ?? {});
  if (keys.length === 1 && keys[0] === "list_price") {
    return `changed the price from ${money(changes.list_price.from as number)} to ${money(changes.list_price.to as number)}`;
  }
  return `edited ${keys.map((k) => FIELD_NAMES[k] ?? k.replace(/_/g, " ")).join(", ")}`;
}

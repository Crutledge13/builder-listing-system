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
import { baths, cx, dateTime, money, num } from "@/lib/format";
import { SourceBadge, StatusBadge } from "@/components/badges";
import { HomeArt } from "@/components/home-art";
import { changeStatus, saveHome } from "./actions";

export default function HomePage(props: PageProps<"/homes/[id]">) {
  return (
    <Suspense fallback={<div className="mt-16 aspect-[21/9] animate-pulse rounded-2xl bg-soft" />}>
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
    title: "Description",
    fields: [{ name: "public_remarks", label: "Listing description (goes in the MLS public remarks)", type: "textarea", wide: true }],
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
    title: "Location",
    fields: [
      { name: "unparsed_address", label: "Street address", wide: true },
      { name: "city", label: "City" },
      { name: "postal_code", label: "ZIP" },
      { name: "lot_number", label: "Lot and block" },
      { name: "plan_name", label: "Floor plan" },
    ],
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
  const steps = Object.keys(STATUS_LABELS) as WorkflowStatus[];

  const facts = [
    { value: home.bedrooms_total ?? "—", label: "beds" },
    { value: baths(home.bathrooms_full, home.bathrooms_half), label: "baths" },
    { value: num(home.living_area), label: "sq ft" },
    { value: home.lot_size_acres ?? "—", label: "acres" },
    { value: home.stories ?? "—", label: home.stories === 1 ? "story" : "stories" },
    { value: home.garage_spaces ?? "—", label: "car garage" },
  ];

  return (
    <div>
      <Link href="/homes" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground">
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        All homes
      </Link>

      <h1 className="mt-3 text-[28px] font-bold leading-tight tracking-tight">{home.unparsed_address}</h1>
      <p className="mt-1 text-muted">
        {home.communities?.name}, {home.city}, TX {home.postal_code}
        {isStaff(me.role) ? `. Built by ${home.builders?.name.replace(" (demo)", "")}` : ""}
      </p>

      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {saved && (
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {saved === "status" ? "Status updated." : "Changes saved."}
        </p>
      )}

      {/* Gallery: one large picture and four smaller tiles, like a listing page. */}
      <div className="mt-6 grid gap-2 overflow-hidden rounded-2xl md:grid-cols-4 md:grid-rows-2 md:[height:440px]">
        <div className="relative aspect-[4/3] md:col-span-2 md:row-span-2 md:aspect-auto">
          <HomeArt seed={home.id} stories={home.stories} scene="day" className="h-full w-full" />
        </div>
        <div className="hidden md:block"><HomeArt seed={home.id} stories={home.stories} scene="golden" className="h-full w-full" /></div>
        <div className="hidden md:block"><HomeArt seed={home.id} stories={home.stories} scene="twilight" className="h-full w-full" /></div>
        <Link href="/media" className="hidden items-center justify-center bg-soft p-4 text-center text-sm text-muted hover:bg-line/60 md:flex">
          Interior photos will show here once the media library is on
        </Link>
        <Link href="/media" className="hidden items-center justify-center bg-soft p-4 text-center text-sm text-muted hover:bg-line/60 md:flex">
          Floor plan
        </Link>
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-6">
            <div>
              <h2 className="text-[22px] font-semibold">The {home.plan_name} plan</h2>
              <p className="text-muted">
                {STAGE_LABELS[home.build_stage]}
                {home.estimated_completion ? `, estimated ${new Date(home.estimated_completion + "T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}` : ""}
                {home.lot_number ? `. Lot ${home.lot_number}` : ""}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-y-6 border-b border-line py-6 sm:grid-cols-6">
            {facts.map((f) => (
              <div key={f.label}>
                <dt className="text-sm text-muted">{f.label}</dt>
                <dd className="text-xl font-semibold tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>

          <form action={saveHome} className="divide-y divide-line">
            <input type="hidden" name="id" value={home.id} />
            {SECTIONS.map((section) => (
              <section key={section.title} className="py-8">
                <h3 className="text-lg font-semibold">{section.title}</h3>
                <div className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map((f) => (
                    <Field key={f.name} def={f} value={home[f.name]} source={sources[f.name]} canEdit={editable.has(f.name)} />
                  ))}
                </div>
              </section>
            ))}
            <div className="flex flex-wrap items-center gap-4 py-8">
              {editable.size > 0 ? (
                <>
                  <button className="rounded-xl bg-foreground px-6 py-3 font-semibold text-white hover:bg-black">Save changes</button>
                  <span className="text-sm text-muted">As {ROLE_LABELS[me.role].toLowerCase()}, you can edit the fields that aren’t grayed out.</span>
                </>
              ) : (
                <span className="text-sm text-muted">As {ROLE_LABELS[me.role].toLowerCase()}, you can view these details but not change them.</span>
              )}
            </div>
          </form>

          <section className="border-t border-line py-8">
            <h3 className="text-lg font-semibold">Activity</h3>
            <ul className="mt-4 space-y-4">
              {activity?.map((a) => {
                const who = a.actor_id ? (actorName.get(a.actor_id) ?? "Someone") : "Initial import";
                return (
                  <li key={a.id} className="flex gap-3 text-[15px]">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-semibold">
                      {who.split(" ").map((p: string) => p[0]).slice(0, 2).join("")}
                    </span>
                    <div>
                      <span className="font-semibold">{who}</span>{" "}
                      <span>{describe(a.action, a.changes as Record<string, { from: unknown; to: unknown }>)}</span>
                      <div className="text-sm text-muted">{dateTime(a.created_at)}</div>
                    </div>
                  </li>
                );
              })}
              {!activity?.length && <li className="text-muted">No activity yet.</li>}
            </ul>
          </section>
        </div>

        {/* Sticky side card, like a booking box. */}
        <aside>
          <div className="card-lift sticky top-28 rounded-2xl border border-line bg-white p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[26px] font-bold tabular-nums leading-none">{money(home.list_price)}</div>
                {home.living_area && home.list_price && (
                  <div className="mt-1 text-sm text-muted">{money(Number(home.list_price) / home.living_area)} per sq ft</div>
                )}
              </div>
              <StatusBadge status={status} />
            </div>

            <ol className="mt-6">
              {steps.map((s, i) => {
                const reached = steps.indexOf(status) >= i;
                const current = s === status;
                return (
                  <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && (
                      <span className={cx("absolute left-[9px] top-5 h-[calc(100%-12px)] w-[2px]", steps.indexOf(status) > i ? "bg-foreground" : "bg-line")} />
                    )}
                    <span
                      className={cx(
                        "relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                        reached ? "border-foreground bg-foreground" : "border-line bg-white",
                      )}
                    >
                      {reached && (
                        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="m2.5 6.2 2.3 2.3 4.7-5" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </span>
                    <span className={cx("text-[15px]", current ? "font-semibold" : reached ? "" : "text-muted")}>
                      {STATUS_LABELS[s]}
                      {s === "live_on_mls" && home.mls_number && <span className="block text-sm font-normal text-muted">MLS {home.mls_number}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>

            {transitions.length > 0 ? (
              <div className="mt-6 space-y-3">
                {transitions.map((to) => {
                  const backward = to === "draft" || (status === "approved_for_mls" && to === "in_review");
                  return (
                    <form key={to} action={changeStatus} className="space-y-3">
                      <input type="hidden" name="id" value={home.id} />
                      <input type="hidden" name="from" value={status} />
                      <input type="hidden" name="to" value={to} />
                      {to === "live_on_mls" && (
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium">MLS number</span>
                          <input name="mls_number" placeholder="From the MLS after you enter it" required className="field-input" />
                        </label>
                      )}
                      <button
                        className={cx(
                          "w-full rounded-xl px-4 py-3 font-semibold",
                          backward ? "border border-foreground hover:bg-soft" : "bg-accent text-white hover:brightness-110",
                        )}
                      >
                        {status === "approved_for_mls" && to === "in_review" ? "Send back for changes" : TRANSITION_LABELS[to]}
                      </button>
                    </form>
                  );
                })}
              </div>
            ) : (
              <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-sm text-muted">{nextStepHint(status)}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ def, value, source, canEdit }: { def: FieldDef; value: unknown; source?: string; canEdit: boolean }) {
  const v = value === null || value === undefined ? "" : String(value);
  const common = { name: def.name, disabled: !canEdit, className: "field-input", defaultValue: v };
  return (
    <label className={cx("block", def.wide && "sm:col-span-2 lg:col-span-3")}>
      <span className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium">
        {def.label} <SourceBadge source={source} />
      </span>
      {def.type === "textarea" ? (
        <textarea {...common} rows={5} className="field-input leading-relaxed" />
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
  return `edited the ${keys.map((k) => FIELD_NAMES[k] ?? k.replace(/_/g, " ")).join(", ")}`;
}

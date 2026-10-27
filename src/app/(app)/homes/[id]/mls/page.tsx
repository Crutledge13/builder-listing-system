import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { cx } from "@/lib/format";
import { formatMls, resolveField, sheetRuleProblems, type MlsField } from "@/lib/mls-fields";
import { loadMlsSheet, type MlsSheet } from "@/lib/mls-sheet";
import { Notice } from "@/components/notice";
import { IncentiveSheet, MlsScore, RoomList } from "@/components/mls-sheet";
import { saveMlsSheet } from "./actions";

export default function MlsSheetPage(props: PageProps<"/homes/[id]/mls">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Sheet params={props.params} />
    </Suspense>
  );
}

async function Sheet({ params }: { params: PageProps<"/homes/[id]/mls">["params"] }) {
  const { id } = await params;
  const me = await requireProfile();
  if (!isStaff(me.role)) redirect(`/homes/${id}`);
  const supabase = await createClient();
  const sheet = await loadMlsSheet(supabase, id);
  if (!sheet) notFound();
  const h = sheet.home;
  const communityName = h.communities?.name ?? "this community";
  const { data: tasks } = await supabase.from("tasks").select("id, title").eq("home_id", id).in("kind", ["mls_entry", "mls_update", "listing_status"]).in("status", ["todo", "in_progress"]);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/homes/${id}`} className="text-sm font-medium text-muted hover:text-foreground">← {h.unparsed_address}</Link>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">MLS sheet{sheet.board ? `: ${sheet.board.short_name}` : ""}</h1>
      <p className="mt-1 text-muted">
        Everything the MLS asks for, in the order you enter it. The builder’s fields come from the home; our team fills in the rest here.
        Fields marked “Shared” apply to every home in {communityName}.
      </p>
      {tasks && tasks.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tasks.map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`} className="rounded-full bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent hover:underline">Open task: {t.title}</Link>
          ))}
        </div>
      )}
      <div className="mt-6"><MlsScore sheet={sheet} homeId={id} edit={false} /></div>
      {(() => {
        const problems = sheetRuleProblems(sheet.sections, sheet.home, sheet.homeDetails, sheet.communityDetails);
        return problems.length ? (
          <ul className="mt-3 space-y-1 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            {problems.map((p) => <li key={p}>✕ {p}</li>)}
          </ul>
        ) : null;
      })()}

      <form action={saveMlsSheet} className="mt-6 space-y-6">
        <input type="hidden" name="home_id" value={id} />
        <input type="hidden" name="back" value={`/homes/${id}/mls`} />
        {sheet.sections.map((section) => (
          <section key={section.title} className="overflow-hidden rounded-2xl border border-line">
            <h2 className="bg-soft px-4 py-2.5 font-semibold">{section.title}</h2>
            <div className="divide-y divide-line">
              {section.fields.map((f) => <FieldRow key={f.key} f={f} sheet={sheet} communityName={communityName} admin={me.role === "platform_admin"} />)}
            </div>
          </section>
        ))}
        <RoomList sheet={sheet} />
        <IncentiveSheet sheet={sheet} />
        <div className="sticky bottom-4 flex justify-end">
          <button className="rounded-xl bg-accent px-6 py-3 font-semibold text-white shadow-lg hover:brightness-110">Save MLS sheet</button>
        </div>
      </form>
    </div>
  );
}

function FieldRow({ f, sheet, communityName, admin }: { f: MlsField; sheet: MlsSheet; communityName: string; admin: boolean }) {
  const r = resolveField(f, sheet.home, sheet.homeDetails, sheet.communityDetails);
  const editable = f.source === "detail" || f.source === "community";
  // For shared fields, edit the community's value.
  const current = f.source === "community" ? sheet.communityDetails[f.key] : f.source === "detail" ? sheet.homeDetails[f.key] : r.value;
  const missing = r.from === "missing";
  return (
    <div className={cx("grid gap-2 px-4 py-3 sm:grid-cols-[220px_1fr]", missing && f.required && "bg-amber-50/60")}>
      <div className="text-sm">
        <span className="font-medium">{f.label}</span>
        {f.required && <span className="text-red-700"> *</span>}
        <span className="block text-[11px] text-muted">{f.key}</span>
        {f.source === "community" && <span className="mt-0.5 inline-block rounded bg-accent-soft px-1.5 py-px text-[10px] font-semibold text-accent">Shared: all of {communityName}</span>}
      </div>
      <div className="min-w-0">
        {editable ? (
          <>
            <input type="hidden" name={`present_${f.key}`} value="1" />
            <Input f={f} value={current} />
          </>
        ) : (
          <p className={cx("py-1.5 text-[15px]", missing && "text-amber-900")}>
            {missing ? "Missing" : formatMls(f, r.value)}{" "}
            <span className="text-xs text-muted">
              {f.source === "home" || (f.source === "builder" && r.from !== "derived") ? (
                <>From the builder’s home details.{admin ? <> <Link href={`/homes/${sheet.home.id}`} className="underline">Edit on the home</Link></> : missing ? " Ask the builder for it." : ""}</>
              ) : "Filled in automatically."}
            </span>
          </p>
        )}
        {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
      </div>
    </div>
  );
}

function Input({ f, value }: { f: MlsField; value: unknown }) {
  const v = value === null || value === undefined ? "" : value;
  if (f.type === "multi") {
    const set = new Set(Array.isArray(v) ? (v as string[]) : []);
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-2 py-1">
        {f.options!.map((o) => (
          <label key={o} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={f.key} value={o} defaultChecked={set.has(o)} className="h-4 w-4 accent-[#3452c7]" /> {o}
          </label>
        ))}
      </div>
    );
  }
  if (f.type === "select" || f.type === "yesno") {
    const opts = f.options ?? ["Yes", "No"];
    return (
      <select name={f.key} defaultValue={String(v)} className="field-input">
        <option value="">Not set</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (f.type === "longtext") return <textarea name={f.key} defaultValue={String(v)} rows={3} className="field-input leading-relaxed" />;
  return (
    <input
      name={f.key}
      defaultValue={String(v)}
      type={f.type === "date" ? "date" : "text"}
      inputMode={f.type === "number" || f.type === "money" ? "decimal" : undefined}
      className="field-input"
    />
  );
}

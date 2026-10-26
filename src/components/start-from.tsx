"use client";

import { useEffect, useState } from "react";

// "Save time: start from something" on Add a home. Fills the form from a floor
// plan, an existing listing, or a home on the builder's website. It works on
// the form's own fields by name, so it fills every step at once. Anything the
// person typed or ticked themselves is never replaced.

export type Prefill = Record<string, string | string[]>; // field name → value(s)
export type PlanOption = { builder_id: string; plan: string; from: string; values: Prefill };
export type CopyOption = { id: string; builder_id: string; label: string; live: boolean; values: Prefill };
export type WebsiteOption = { id: string; builder_id: string; community_id: string | null; label: string; values: Prefill };

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function StartFrom({
  formId,
  communityBuilders,
  plans,
  homes,
  website,
}: {
  formId: string;
  communityBuilders: Record<string, string>;
  plans: PlanOption[];
  homes: CopyOption[];
  website: WebsiteOption[];
}) {
  const [communityId, setCommunityId] = useState("");
  const [websiteId, setWebsiteId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const readCommunity = () => setCommunityId((form.elements.namedItem("community_id") as HTMLSelectElement | null)?.value ?? "");
    // Remember what the person touched, and drop the "filled from" note when they change it.
    const touched = (e: Event) => {
      if (!e.isTrusted) return;
      const t = e.target as Field;
      if (!t.name || t.name === "community_id") return;
      form.querySelectorAll<Field>(`[name="${CSS.escape(t.name)}"]`).forEach((x) => (x.dataset.typed = "1"));
      wrapperOf(t)?.removeAttribute("data-filled-from");
    };
    readCommunity();
    form.addEventListener("change", readCommunity);
    form.addEventListener("input", touched);
    form.addEventListener("change", touched);
    return () => {
      form.removeEventListener("change", readCommunity);
      form.removeEventListener("input", touched);
      form.removeEventListener("change", touched);
    };
  }, [formId]);

  const builderId = communityBuilders[communityId] ?? null;
  const mine = <T extends { builder_id: string }>(list: T[]) => list.filter((x) => x.builder_id === builderId);

  function fill(values: Prefill, label: string) {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let n = 0;
    for (const [name, v] of Object.entries(values)) {
      if (v === "" || (Array.isArray(v) && v.length === 0)) continue;
      const els = [...form.querySelectorAll<Field>(`[name="${CSS.escape(name)}"]`)].filter((e) => e.type !== "hidden" && !e.disabled);
      if (!els.length || els.some((e) => e.dataset.typed)) continue;
      const first = els[0];
      if (first instanceof HTMLInputElement && (first.type === "checkbox" || first.type === "radio")) {
        const on = new Set((Array.isArray(v) ? v : [v]).map(String));
        els.forEach((e) => ((e as HTMLInputElement).checked = on.has(e.value)));
      } else if (first instanceof HTMLSelectElement) {
        const want = String(v);
        if (![...first.options].some((o) => o.value === want)) continue;
        first.value = want;
      } else {
        first.value = String(v);
      }
      wrapperOf(first)?.setAttribute("data-filled-from", label);
      n++;
    }
    // Let the step bar and required highlighting recount.
    form.dispatchEvent(new Event("input", { bubbles: true }));
    setMessage(n ? `Filled in ${n} ${n === 1 ? "answer" : "answers"} from ${label}, across all the steps. Check them, then add what’s missing.` : `Nothing new to fill in from ${label}.`);
  }

  function pickWebsite(w: WebsiteOption) {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const select = form?.elements.namedItem("community_id") as HTMLSelectElement | null;
    if (select && w.community_id && select.value !== w.community_id) {
      select.value = w.community_id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setWebsiteId(w.id);
    fill(w.values, "your website");
  }

  return (
    <section className="rounded-2xl border border-accent/30 bg-accent-soft/50 p-5">
      <input type="hidden" name="website_listing_id" value={websiteId} />
      <h3 className="font-semibold">Save time: start from something</h3>
      <p className="mt-1 text-sm text-muted">Pick one and we’ll fill in what we know on every step. Anything you’ve typed yourself is never replaced.</p>
      {!builderId && <p className="mt-3 text-sm font-medium text-accent">Choose the community above to see your plans, listings and website homes.</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Starter
          title="A floor plan"
          hint="Beds, baths, size, stories and layout from the latest home on that plan."
          empty="No plans yet. They show up once a home with a plan is added."
          options={mine(plans).map((p) => ({ id: p.plan, label: p.plan }))}
          onPick={(id) => {
            const p = mine(plans).find((x) => x.plan === id);
            if (p) fill(p.values, `the ${p.plan} plan`);
          }}
          off={!builderId}
        />
        <Starter
          title="Copy a listing"
          hint="Everything from a home you already have, except its address, lot, parcel and lockbox."
          empty="No other homes yet."
          options={mine(homes).map((h) => ({ id: h.id, label: h.label + (h.live ? " · live" : "") }))}
          onPick={(id) => {
            const h = mine(homes).find((x) => x.id === id);
            if (h) fill(h.values, h.label.split(",")[0]);
          }}
          off={!builderId}
        />
        <Starter
          title="From your website"
          hint="Homes on your website that aren’t in Builder Listings yet."
          empty="No new homes found on your website."
          options={mine(website).map((w) => ({ id: w.id, label: w.label }))}
          onPick={(id) => {
            const w = mine(website).find((x) => x.id === id);
            if (w) pickWebsite(w);
          }}
          off={!builderId}
        />
      </div>
      {message && <p className="mt-3 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-accent">{message}</p>}
    </section>
  );
}

// The box around one question: an NTREIS answer's fieldset, or the field's label.
function wrapperOf(el: Element) {
  return el.closest("fieldset[data-ntreis]") ?? el.closest("label");
}

function Starter({ title, hint, empty, options, onPick, off }: {
  title: string;
  hint: string;
  empty: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
  off: boolean;
}) {
  const [pick, setPick] = useState("");
  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-3">
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
      {off ? null : options.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{empty}</p>
      ) : (
        <div className="mt-auto flex gap-2 pt-3">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="field-input min-w-0 flex-1 py-2 text-sm" aria-label={title} data-starter="">
            <option value="">Choose…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <button type="button" disabled={!pick} onClick={() => onPick(pick)} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Fill in</button>
        </div>
      )}
    </div>
  );
}

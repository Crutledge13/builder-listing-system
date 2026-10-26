"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";

export type Step = { title: string; ntreisOnly?: boolean };

// A long form shown one step at a time, like Matrix's tabs: a step bar on
// top, Back / Next underneath, and Save draft on every step. Every step stays
// in the same <form> (only hidden), so moving around never loses what's typed
// and saving sends everything. Steps made only of NTREIS questions drop out
// when the home is going to another MLS (NtreisToggle sets form.dataset.ntreis).
// Fields marked data-required="Label" are counted so each step shows what's left.
export function FormSteps({ formId, steps, children }: { formId: string; steps: Step[]; children: ReactNode }) {
  const panels = Children.toArray(children);
  const all = [...steps, { title: "Review" }];
  const [cur, setCur] = useState(0);
  const [ntreis, setNtreis] = useState(true);
  const [missing, setMissing] = useState<string[][]>(() => all.map(() => []));
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const top = useRef<HTMLDivElement | null>(null);

  const shown = all.map((s, i) => ({ ...s, i })).filter((s) => !(s.ntreisOnly && !ntreis));
  // If the open step dropped out (the home now goes to another MLS), show the first.
  const active = shown.some((s) => s.i === cur) ? cur : shown[0].i;
  const pos = shown.findIndex((s) => s.i === active);
  const last = pos === shown.length - 1;

  const count = useCallback(() => {
    setMissing(
      all.map((_, i) => {
        const el = refs.current[i];
        if (!el) return [];
        return [...el.querySelectorAll<HTMLElement>("[data-required]")]
          // Skip questions switched off for this MLS (not just ones on another step).
          .filter((w) => !w.closest("fieldset[data-ntreis][hidden], [data-other-mls][hidden]"))
          .filter((w) => {
            const inputs = [...w.querySelectorAll<HTMLInputElement>("input:not([type=hidden]), select, textarea")];
            return !inputs.some((x) => (x.type === "checkbox" || x.type === "radio" ? x.checked : x.value.trim() !== ""));
          })
          .map((w) => w.dataset.required!);
      }),
    );
    // all is rebuilt each render from steps; steps is stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps]);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const onNtreis = () => {
      setNtreis(form.dataset.ntreis !== "0");
      count();
    };
    // A required box on another step blocks saving: open that step and point at it.
    const onInvalid = (e: Event) => {
      const i = refs.current.findIndex((el) => el?.contains(e.target as Node));
      if (i >= 0) {
        setCur(i);
        setTimeout(() => (e.target as HTMLInputElement).reportValidity?.(), 60);
      }
    };
    onNtreis();
    form.addEventListener("input", count);
    form.addEventListener("change", count);
    form.addEventListener("ntreis-change", onNtreis);
    form.addEventListener("invalid", onInvalid, true);
    return () => {
      form.removeEventListener("input", count);
      form.removeEventListener("change", count);
      form.removeEventListener("ntreis-change", onNtreis);
      form.removeEventListener("invalid", onInvalid, true);
    };
  }, [formId, count]);

  const go = (i: number) => {
    setCur(i);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const next = () => {
    // The first step has the boxes a draft can't be saved without.
    const bad = [...(refs.current[active]?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [])].find((x) => !x.checkValidity());
    if (bad) {
      bad.reportValidity();
      return;
    }
    go(shown[Math.min(pos + 1, shown.length - 1)].i);
  };

  const left = shown.slice(0, -1).reduce((n, s) => n + missing[s.i].length, 0);

  return (
    <div ref={top} className="scroll-mt-24">
      {/* Step bar */}
      <nav aria-label="Steps" className="-mx-4 overflow-x-auto px-4 pb-1">
        <ol className="flex min-w-max gap-1 rounded-xl bg-soft p-1">
          {shown.map((s, n) => {
            const on = s.i === active;
            const todo = missing[s.i]?.length ?? 0;
            const isReview = s.i === all.length - 1;
            return (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => go(s.i)}
                  aria-current={on ? "step" : undefined}
                  className={cx(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition",
                    on ? "bg-accent text-white shadow-sm" : "text-muted hover:bg-white hover:text-foreground",
                  )}
                >
                  <span className={cx("text-xs tabular-nums", on ? "text-white/80" : "text-muted")}>{n + 1}</span>
                  {s.title}
                  {!isReview && todo > 0 && (
                    <span className={cx("rounded-full px-1.5 text-[11px] leading-5", on ? "bg-white/25 text-white" : "bg-amber-100 text-amber-900")} title={`${todo} required by NTREIS`}>
                      {todo}
                    </span>
                  )}
                  {!isReview && todo === 0 && n > 0 && <span aria-hidden className={on ? "text-white" : "text-emerald-600"}>✓</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Steps (all in the form; only the current one shows) */}
      {panels.map((p, i) => (
        <div key={i} ref={(el) => { refs.current[i] = el; }} hidden={i !== active} className="py-6">
          <h2 className="text-xl font-semibold">{all[i].title}</h2>
          {p}
        </div>
      ))}
      <div ref={(el) => { refs.current[all.length - 1] = el; }} hidden={active !== all.length - 1} className="py-6">
        <h2 className="text-xl font-semibold">Review</h2>
        <p className="mt-1 text-sm text-muted">
          {left === 0
            ? "Everything NTREIS requires from you is filled in."
            : `${left} required ${left === 1 ? "answer is" : "answers are"} still empty. You can save the draft now and finish later; they're needed before the listing goes live.`}
        </p>
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {shown.slice(0, -1).map((s) => (
            <li key={s.title} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <span className="font-medium">{s.title}</span>
                {missing[s.i].length > 0 ? (
                  <span className="mt-0.5 block text-sm text-amber-900">Still needed: {missing[s.i].join(", ")}</span>
                ) : (
                  <span className="mt-0.5 block text-sm text-emerald-700">✓ Done</span>
                )}
              </div>
              <button type="button" onClick={() => go(s.i)} className="text-sm font-semibold text-accent underline">
                {missing[s.i].length > 0 ? "Finish" : "Review"}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Back / Next, and Save draft on every step */}
      <div className="sticky bottom-4 z-10 mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={() => go(shown[Math.max(pos - 1, 0)].i)}
          disabled={pos === 0}
          className="rounded-xl border border-foreground px-4 py-2.5 font-semibold disabled:border-line disabled:text-muted"
        >
          Back
        </button>
        <span className="text-sm text-muted">Step {pos + 1} of {shown.length}</span>
        <span className="flex-1" />
        <button className={cx("rounded-xl px-4 py-2.5 font-semibold", last ? "bg-accent px-6 text-white hover:brightness-110" : "border border-line hover:border-foreground")}>
          Save draft
        </button>
        {!last && (
          <button type="button" onClick={next} className="rounded-xl bg-accent px-6 py-2.5 font-semibold text-white hover:brightness-110">
            Next: {shown[pos + 1]?.title}
          </button>
        )}
      </div>
    </div>
  );
}

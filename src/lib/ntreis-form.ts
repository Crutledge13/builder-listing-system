import { NTREIS_BUILDER_FIELDS, STORIES_FROM_LEVELS } from "@/lib/ntreis-fields";
import type { MlsField } from "@/lib/mls-fields";

// Who may change the builder's NTREIS answers after a home is added
// (same people who can edit its specs; mirrors enforce_home_edit_rules).
export function canEditMlsAnswers(role: string) {
  return ["platform_admin", "builder_owner", "manager", "marketing"].includes(role);
}

const BY_KEY = new Map(NTREIS_BUILDER_FIELDS.map((f) => [f.key, f]));

function readOne(f: MlsField, formData: FormData): unknown {
  const name = `mls__${f.key}`;
  if (f.type === "multi") {
    const allowed = new Set(f.options ?? []);
    return [...new Set(formData.getAll(name).map(String))].filter((v) => allowed.has(v));
  }
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  if (f.type === "select" || f.type === "yesno") return (f.options ?? ["Yes", "No"]).includes(raw) ? raw : null;
  if (f.type === "number" || f.type === "money") {
    const n = Number(raw.replace(/[$,]/g, ""));
    return Number.isNaN(n) ? undefined : n; // undefined = not a number
  }
  return raw.slice(0, 2000);
}

// The builder's NTREIS answers from a form, merged into what's already saved.
// Only fields that were on the form (each sends an "mls_key") are touched, so
// unchecking every box clears that field. Returns the keys that changed.
export function readMlsAnswers(formData: FormData, existing: Record<string, unknown> = {}) {
  const next: Record<string, unknown> = { ...existing };
  const changed: string[] = [];
  const badNumbers: string[] = [];
  for (const key of new Set(formData.getAll("mls_key").map(String))) {
    const f = BY_KEY.get(key);
    if (!f) continue;
    const v = readOne(f, formData);
    if (v === undefined) {
      badNumbers.push(f.label);
      continue;
    }
    const empty = v === null || (Array.isArray(v) && v.length === 0);
    const before = JSON.stringify(existing[key] ?? null);
    if (empty) delete next[key];
    else next[key] = v;
    if (JSON.stringify(next[key] ?? null) !== before) changed.push(key);
  }
  return { values: next, changed, badNumbers };
}

// Our stories column, from the builder's NTREIS "Levels" answer.
export function storiesFromLevels(levels: unknown): number | null {
  return typeof levels === "string" ? (STORIES_FROM_LEVELS[levels] ?? null) : null;
}

// field_sources entries for changed answers ("mls_fields.Roof": "staff").
export function answerSources(changed: string[]) {
  return Object.fromEntries(changed.map((k) => [`mls_fields.${k}`, "staff"]));
}

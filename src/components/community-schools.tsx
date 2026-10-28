"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type Schools = { district?: string; elementary?: string; middle?: string; high?: string };

// The "Location and schools" step of Add a home. Schools are answered once
// per community (community setup), not per home, so this shows the chosen
// community's answers and where to change them (tester notes, 28 Oct 2026:
// the step looked like it had forgotten the schools).
export function CommunitySchools({ formId, schools, canEdit }: { formId: string; schools: Record<string, Schools>; canEdit: boolean }) {
  const [communityId, setCommunityId] = useState<string>("");

  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>(`#${formId} select[name="community_id"]`);
    if (!select) return;
    const read = () => setCommunityId(select.value);
    read();
    select.addEventListener("change", read);
    return () => select.removeEventListener("change", read);
  }, [formId]);

  const s = communityId ? schools[communityId] : undefined;
  const rows: [string, string | undefined][] = [
    ["School district", s?.district],
    ["Elementary", s?.elementary],
    ["Middle or junior high", s?.middle],
    ["High school", s?.high],
  ];
  const filled = rows.some(([, v]) => v);

  return (
    <div className="rounded-xl bg-soft px-4 py-3 text-sm sm:col-span-2 lg:col-span-3">
      <p className="font-medium">Schools</p>
      {!communityId ? (
        <p className="mt-1 text-muted">Schools come from the community. Pick the community on the first step to see them here.</p>
      ) : (
        <>
          <p className="mt-1 text-muted">Set once for the whole community, so you don&rsquo;t enter them for each home.</p>
          {filled ? (
            <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {rows.map(([label, v]) => (
                <div key={label} className="flex gap-2">
                  <dt className="text-muted">{label}:</dt>
                  <dd className="font-medium">{v || "not set"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 font-medium text-amber-800">This community&rsquo;s schools aren&rsquo;t set yet. The MLS needs at least the school district.</p>
          )}
          {canEdit && (
            <Link href={`/communities/${communityId}/setup`} target="_blank" className="mt-2 inline-block font-semibold text-accent underline">
              {filled ? "Change on the community’s setup" : "Add them on the community’s setup"}
            </Link>
          )}
        </>
      )}
    </div>
  );
}

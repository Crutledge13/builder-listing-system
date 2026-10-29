"use client";

import { useState } from "react";
import { setSalesMls } from "@/app/(app)/sales-mls-actions";

// A salesperson's two switches (owners, 29 Oct 2026), under their communities
// on Team and Admin > People. "Needs marketing approval" only shows while
// "MLS entry" is on, and starts ticked.
export function SalesMlsSwitches({
  profileId,
  name,
  mlsEntry,
  needsApproval,
  back,
}: {
  profileId: string;
  name: string;
  mlsEntry: boolean;
  needsApproval: boolean;
  back: string;
}) {
  const [on, setOn] = useState(mlsEntry);
  const [approval, setApproval] = useState(needsApproval);
  const changed = on !== mlsEntry || (on && approval !== needsApproval);
  const summary = !mlsEntry ? "Standard" : needsApproval ? "Enters homes for the MLS, marketing approves" : "Enters homes for the MLS, no approval";

  return (
    <details className="group mt-2 rounded-xl bg-soft">
      <summary className="flex items-center gap-2 px-3 py-2.5 text-sm">
        <span className="font-medium">MLS entry:</span>
        <span className="min-w-0 flex-1 truncate text-muted">{summary}</span>
        <span className="text-xs font-semibold text-accent group-open:hidden">Change</span>
      </summary>
      <form action={setSalesMls} className="space-y-3 px-3 pb-3 text-sm">
        <input type="hidden" name="profile_id" value={profileId} />
        <input type="hidden" name="back" value={back} />
        <label className="flex items-start gap-2.5">
          <input type="checkbox" name="sales_mls_entry" checked={on} onChange={(e) => setOn(e.target.checked)} className="mt-0.5 accent-[#3452c7]" />
          <span>
            <span className="font-medium">Can enter homes for the MLS</span>
            <span className="block text-xs text-muted">
              For their communities only: add homes, fill in every listing detail and description, change the community setup
              (schools, HOA, utilities, showing) and put the listing photos in order.
            </span>
          </span>
        </label>
        {on && (
          <label className="ml-6 flex items-start gap-2.5">
            <input type="checkbox" name="sales_needs_approval" checked={approval} onChange={(e) => setApproval(e.target.checked)} className="mt-0.5 accent-[#3452c7]" />
            <span>
              <span className="font-medium">Needs marketing approval</span>
              <span className="block text-xs text-muted">
                {approval
                  ? `${name.split(" ")[0]} submits homes for review and marketing approves them before our team enters them in the MLS.`
                  : `${name.split(" ")[0]}’s homes go straight to our team, and changes to live listings go straight onto the MLS update.`}
              </span>
            </span>
          </label>
        )}
        <button disabled={!changed} className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-40">
          Save
        </button>
      </form>
    </details>
  );
}

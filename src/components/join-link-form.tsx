"use client";

import { useState } from "react";
import { CommunityPicker } from "@/components/community-picker";
import { PendingButton } from "@/components/pending-button";

type Option = { id: string; name: string };
type Community = Option & { builder_id: string };

const STAFF_ROLES = ["listing_coordinator", "photographer"];

// Make a join link: pick the role, then the builder (builder roles), the
// communities (sales) or the builders they work on (coordinators).
export function JoinLinkForm({
  action,
  roles,
  builders,
  communities,
  disabled,
}: {
  action: (formData: FormData) => void;
  roles: { value: string; label: string }[];
  builders: Option[];
  communities: Community[];
  disabled: boolean;
}) {
  const [role, setRole] = useState("photographer");
  const [builder, setBuilder] = useState("");
  const staff = STAFF_ROLES.includes(role);
  const theirCommunities = communities.filter((c) => c.builder_id === builder);

  return (
    <form action={action}>
      <fieldset disabled={disabled} className="space-y-3 disabled:opacity-60">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">They join as</span>
          <select name="role" value={role} onChange={(e) => setRole(e.target.value)} className="field-input">
            {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>

        {!staff && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Builder</span>
            <select name="builder_id" required value={builder} onChange={(e) => setBuilder(e.target.value)} className="field-input">
              <option value="">Pick a builder</option>
              {builders.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}

        {(role === "sales" || role === "online_sales") && builder && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Communities they see</legend>
            {theirCommunities.length ? (
              <CommunityPicker key={builder} communities={theirCommunities} />
            ) : (
              <p className="text-xs text-muted">This builder has no communities yet. Assign them after they join.</p>
            )}
          </fieldset>
        )}

        {role === "listing_coordinator" && (
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Builders they work on</legend>
            <p className="mb-1.5 text-xs text-muted">None ticked: they see every builder.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {builders.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="staff_builder_id" value={b.id} className="h-4 w-4 accent-[#3452c7]" /> {b.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Name for this link (optional)</span>
          <input name="label" maxLength={120} placeholder="e.g. Photographers, fall 2026" className="field-input" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Works for</span>
            <select name="days" defaultValue="30" className="field-input">
              <option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">How many people</span>
            <input name="max_uses" type="number" min={1} max={500} placeholder="No limit" className="field-input" />
          </label>
        </div>
        <PendingButton pending="Making link…" className="w-full justify-center rounded-xl bg-accent px-4 py-2.5 font-semibold text-white hover:brightness-110">
          Make join link
        </PendingButton>
      </fieldset>
    </form>
  );
}

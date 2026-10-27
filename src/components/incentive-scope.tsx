"use client";

import { useState } from "react";

type Opt = { id: string; label: string; builder_id: string; community_id?: string | null };

// Who the incentive covers: the whole builder, one community, or one home.
export function IncentiveScope({
  builders,
  communities,
  homes,
  initial,
}: {
  builders: { id: string; name: string }[] | null; // only for our admins, who pick the builder
  communities: Opt[];
  homes: Opt[];
  initial: { scope: "builder" | "community" | "home"; builderId?: string; communityId?: string; homeId?: string };
}) {
  const [scope, setScope] = useState(initial.scope);
  const [builderId, setBuilderId] = useState(initial.builderId ?? builders?.[0]?.id ?? "");
  const [communityId, setCommunityId] = useState(initial.communityId ?? "");
  const mineC = builders ? communities.filter((c) => c.builder_id === builderId) : communities;
  const mineH = (builders ? homes.filter((h) => h.builder_id === builderId) : homes).filter((h) => !communityId || h.community_id === communityId);
  const pill = (v: typeof scope, label: string) => (
    <label className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-sm ${scope === v ? "border-foreground bg-foreground font-semibold text-white" : "border-line hover:border-foreground"}`}>
      <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="sr-only" />
      {label}
    </label>
  );
  return (
    <div className="space-y-3 sm:col-span-2">
      {builders && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Builder</span>
          <select name="builder_id" value={builderId} onChange={(e) => { setBuilderId(e.target.value); setCommunityId(""); }} className="field-input">
            {builders.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <div>
        <span className="mb-1.5 block text-sm font-medium">Who it&rsquo;s for</span>
        <div className="flex flex-wrap gap-2">
          {pill("builder", "Every community")}
          {pill("community", "One community")}
          {pill("home", "One home")}
        </div>
      </div>
      {scope !== "builder" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{scope === "home" ? "Community (to narrow the homes)" : "Community"}</span>
          <select name="community_id" value={communityId} onChange={(e) => setCommunityId(e.target.value)} required={scope === "community"} className="field-input">
            <option value="">{scope === "home" ? "All communities" : "Pick a community"}</option>
            {mineC.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}
      {scope === "home" && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Home</span>
          <select name="home_id" defaultValue={initial.homeId ?? ""} required className="field-input">
            <option value="">Pick a home</option>
            {mineH.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

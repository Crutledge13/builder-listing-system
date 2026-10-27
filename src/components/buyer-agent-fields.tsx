"use client";

import { useState } from "react";

import type { BuyerAgent } from "@/lib/buyer-agent";

// The buyer's agent, asked when a home goes under contract. Only what the MLS
// needs to show who brought the buyer; the database checks it too.
export function BuyerAgentFields({ initial, compact }: { initial?: BuyerAgent; compact?: boolean }) {
  const [none, setNone] = useState(!!initial?.buyer_unrepresented);
  const [co, setCo] = useState(!!initial?.co_buyer_agent_full_name);
  const input = compact ? "field-input py-1.5" : "field-input py-2";

  return (
    <fieldset className="space-y-2 rounded-lg bg-soft/60 p-3">
      <legend className="sr-only">Buyer’s agent</legend>
      <p className="text-sm font-semibold">Buyer’s agent</p>
      <p className="text-xs text-muted">The MLS needs this to mark the home pending. It’s on the contract.</p>

      {!none && (
        <>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Agent’s name</span>
            <input name="buyer_agent_full_name" required defaultValue={initial?.buyer_agent_full_name ?? ""} autoComplete="off" className={input} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Agent’s brokerage</span>
            <input name="buyer_office_name" required defaultValue={initial?.buyer_office_name ?? ""} autoComplete="off" className={input} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">MLS ID <span className="font-normal text-muted">(if known)</span></span>
              <input name="buyer_agent_mls_id" defaultValue={initial?.buyer_agent_mls_id ?? ""} autoComplete="off" className={input} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">TREC license <span className="font-normal text-muted">(if known)</span></span>
              <input name="buyer_agent_state_license" inputMode="numeric" defaultValue={initial?.buyer_agent_state_license ?? ""} autoComplete="off" className={input} />
            </label>
          </div>
          {co ? (
            <div className="space-y-2 border-t border-line pt-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Second agent’s name</span>
                <input name="co_buyer_agent_full_name" defaultValue={initial?.co_buyer_agent_full_name ?? ""} autoComplete="off" className={input} />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Second agent’s brokerage</span>
                <input name="co_buyer_office_name" defaultValue={initial?.co_buyer_office_name ?? ""} autoComplete="off" className={input} />
              </label>
            </div>
          ) : (
            <button type="button" onClick={() => setCo(true)} className="text-xs font-semibold text-accent hover:underline">+ Add a second buyer’s agent</button>
          )}
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="buyer_unrepresented" value="true" checked={none} onChange={(e) => setNone(e.target.checked)} className="h-4 w-4" />
        The buyer has no agent
      </label>
    </fieldset>
  );
}

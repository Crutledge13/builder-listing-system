"use client";

import { useActionState, useState } from "react";
import { getInviteLink, type InviteLinkState } from "@/app/(app)/invite-actions";

// "Get invite link": makes a fresh link for someone who hasn't set a password
// yet, to copy and send any way you like (text, email, chat).
export function InviteLink({ profileId, name }: { profileId: string; name: string }) {
  const [state, action, pending] = useActionState<InviteLinkState, FormData>(getInviteLink, {});
  const [copied, setCopied] = useState(false);

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-soft p-3">
      <p className="text-sm">
        <span className="font-semibold">{name} hasn’t set a password yet.</span>{" "}
        <span className="text-muted">Send them their invite link. It opens a page where they choose a password and start.</span>
      </p>
      {state.link ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} aria-label={`Invite link for ${name}`} className="field-input min-w-0 flex-1 bg-white text-xs" />
          <button type="button" onClick={() => copy(state.link!)} className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white hover:brightness-110">
            {copied ? "Link copied" : "Copy link"}
          </button>
          <p className="w-full text-xs text-muted">Works for 2 days, and they can open it more than once until they’ve set their password. Making a new link turns this one off.</p>
        </div>
      ) : null}
      {state.error && <p className="mt-2 text-sm text-red-800">{state.error}</p>}
      <form action={action} className="mt-2">
        <input type="hidden" name="profile_id" value={profileId} />
        <button disabled={pending} className="text-sm font-semibold text-accent underline disabled:opacity-50">
          {pending ? "Making a link…" : state.link ? "Make a new link" : "Get invite link"}
        </button>
      </form>
    </div>
  );
}

import { saveShootContact } from "@/app/(app)/media/requests/actions";
import { PendingButton } from "@/components/pending-button";

export type PhotoContact = { contact_name: string | null; contact_phone: string | null; contact_email: string | null; access_notes: string | null } | null;

// Who photographers call: the name, phone, email and access notes on every
// photographer job for this builder. The same form shows on Photo requests
// and right inside the setup checklist; `back` is where saving returns to.
export function PhotoContactForm({ c, back, className }: { c: PhotoContact; back: string; className?: string }) {
  return (
    <form action={saveShootContact} className={className ?? "grid gap-3 sm:grid-cols-3"}>
      <input type="hidden" name="back" value={back} />
      <label className="block"><span className="mb-1 block text-sm font-medium">Name</span><input name="contact_name" required defaultValue={c?.contact_name ?? ""} maxLength={80} className="field-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Phone</span><input name="contact_phone" required type="tel" defaultValue={c?.contact_phone ?? ""} maxLength={30} className="field-input" /></label>
      <label className="block"><span className="mb-1 block text-sm font-medium">Email (optional)</span><input name="contact_email" type="email" defaultValue={c?.contact_email ?? ""} maxLength={200} className="field-input" /></label>
      <label className="block sm:col-span-3">
        <span className="mb-1 block text-sm font-medium">Getting in (optional)</span>
        <input name="access_notes" defaultValue={c?.access_notes ?? ""} maxLength={1000} placeholder="e.g. Check in at the model home first. Don’t put lockbox codes here; send those per shoot." className="field-input" />
      </label>
      <div className="sm:col-span-3">
        <PendingButton pending="Saving…" className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save</PendingButton>
      </div>
    </form>
  );
}

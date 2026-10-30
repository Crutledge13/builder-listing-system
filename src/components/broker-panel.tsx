import { createClient } from "@/lib/supabase/server";
import { dateTime } from "@/lib/format";
import { InviteLink } from "@/components/invite-link";
import { addBroker, removeBroker } from "@/app/(app)/broker-actions";

type Broker = { broker_id: string; full_name: string; email: string; phone: string | null; is_active: boolean; added_at: string; removed_at: string | null; needs_password: boolean };

// A builder's outside listing broker (broker mode): who it is, their invite
// link until they've signed in, and add / remove for the owner or our admins.
// Everyone else at the builder just sees who it is.
export async function BrokerPanel({ builderId, canManage, back, brokerMode, title = "Your listing broker", anchor = "broker" }: { builderId: string; canManage: boolean; back: string; brokerMode: boolean; title?: string; anchor?: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("builder_brokers", { p_builder: builderId });
  const all = (data ?? []) as Broker[];
  const current = all.filter((b) => !b.removed_at);
  const past = all.filter((b) => b.removed_at);

  return (
    <section id={anchor} className="scroll-mt-28 rounded-2xl border border-line p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">
        {brokerMode
          ? "Approved listings go to your broker to enter in the MLS. They only see a simple work sheet for each listing, never the rest of Builder Listings. You’re told each time they finish."
          : "Broker mode is off: our team enters your listings. Brokers added here only get work once our team switches you to broker mode."}
      </p>

      {current.length === 0 ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{brokerMode ? "No broker yet. Add one so your approved listings get entered." : "No broker added."}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
          {current.map((b) => (
            <li key={b.broker_id} className="p-3">
              {canManage && b.needs_password && b.is_active && <div className="mb-3"><InviteLink profileId={b.broker_id} name={b.full_name} /></div>}
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{b.full_name}{!b.is_active && <span className="font-normal text-red-700"> (access turned off)</span>}</div>
                  <div className="truncate text-sm text-muted">{[b.email, b.phone].filter(Boolean).join(" · ")}. Added {dateTime(b.added_at)}</div>
                </div>
                {canManage && (
                  <form action={removeBroker}>
                    <input type="hidden" name="builder_id" value={builderId} />
                    <input type="hidden" name="broker_id" value={b.broker_id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50">Remove</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form action={addBroker} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="builder_id" value={builderId} />
          <input type="hidden" name="back" value={back} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Broker’s name</span>
            <input name="full_name" className="field-input" placeholder="Blake Sutton" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input name="email" type="email" required className="field-input" placeholder="blake@brokerage.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Phone <span className="font-normal text-muted">(optional)</span></span>
            <input name="phone" className="field-input" />
          </label>
          <div className="flex items-end">
            <button className="w-full rounded-xl bg-foreground px-4 py-2.5 font-semibold text-white hover:bg-black">{current.length ? "Add another broker" : "Add broker"}</button>
          </div>
          <p className="text-xs text-muted sm:col-span-2">You’ll get an invite link to send them. If they already work for another builder here, they’re simply added.</p>
        </form>
      )}

      {past.length > 0 && (
        <p className="mt-3 text-xs text-muted">Removed before: {past.map((b) => b.full_name).join(", ")}.</p>
      )}
    </section>
  );
}

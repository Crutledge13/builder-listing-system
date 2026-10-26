import Link from "next/link";
import { cx } from "@/lib/format";
import { NEED_LABELS, REQUEST_STATUS_LABELS, type Role } from "@/lib/permissions";
import { whenCentral } from "@/lib/time";
import { createMediaRequest, updateMediaRequest } from "@/app/(app)/media/requests/actions";
import { AddressActions } from "@/components/address-actions";
import { BuilderLogo } from "@/components/avatar";

// What a photographer's card shows about the builder (from public.my_job_info).
export type JobInfo = {
  request_id: string;
  builder_id: string;
  builder_name: string;
  logo_updated_at: string | null;
  map_query: string;
  builder_contact_name: string | null;
  builder_contact_phone: string | null;
  builder_contact_email: string | null;
  access_notes: string | null;
  requester_name: string | null;
  requester_title: string | null;
  requester_phone: string | null;
  requester_email: string | null;
};

export type MediaRequest = {
  id: string;
  home_id: string | null;
  community_id: string;
  needs: string[];
  notes: string | null;
  due_date: string | null;
  status: string;
  photographer_id: string | null;
  photographer_name: string | null;
  scheduled_for: string | null;
  photographer_note: string | null;
  address: string;
  community_name: string;
  builder_name: string;
  requester_name: string | null;
  delivered_at: string | null;
  created_at: string;
};

export const MEDIA_REQUEST_SELECT =
  "id, home_id, community_id, needs, notes, due_date, status, photographer_id, photographer_name, scheduled_for, photographer_note, address, community_name, builder_name, requester_name, delivered_at, created_at";

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-amber-100 text-amber-900",
  assigned: "bg-accent-soft text-accent",
  scheduled: "bg-accent-soft text-accent",
  delivered: "bg-emerald-100 text-emerald-800",
  completed: "bg-soft text-muted",
  cancelled: "bg-soft text-muted",
};

function dueText(d: string | null) {
  if (!d) return null;
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function Hidden({ r, op, back }: { r: MediaRequest; op: string; back: string }) {
  return (
    <>
      <input type="hidden" name="request_id" value={r.id} />
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="back" value={back} />
    </>
  );
}

export function RequestCard({
  r,
  role,
  back,
  photographers,
  showBuilder,
  children,
  job,
  team,
}: {
  job?: JobInfo;
  team?: { email: string | null; phone: string | null };
  r: MediaRequest;
  role: Role;
  back: string;
  photographers?: { id: string; full_name: string }[];
  showBuilder?: boolean;
  children?: React.ReactNode;
}) {
  const admin = role === "platform_admin";
  const photographer = role === "photographer";
  const builderTeam = ["builder_owner", "manager", "sales", "marketing"].includes(role);
  const open = !["completed", "cancelled"].includes(r.status);
  const due = dueText(r.due_date);

  return (
    <article className={cx("rounded-2xl border p-5", r.status === "delivered" && !photographer ? "border-emerald-300" : "border-line")}>
      {photographer && (
        <div className="mb-3 flex items-center gap-3 border-b border-line pb-3">
          {job && <BuilderLogo builderId={job.builder_id} name={job.builder_name} version={job.logo_updated_at} className="h-9 max-w-[120px]" />}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Builder</p>
            <p className="truncate font-semibold">{(job?.builder_name ?? r.builder_name).replace(" (demo)", "")}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {r.home_id && !photographer ? (
            <Link href={`/homes/${r.home_id}`} className="text-lg font-semibold underline-offset-2 hover:underline">{r.address}</Link>
          ) : (
            <h3 className="text-lg font-semibold">{r.address}</h3>
          )}
          <p className="text-sm text-muted">
            {r.community_name}
            {showBuilder && !photographer ? `, ${r.builder_name.replace(" (demo)", "")}` : ""}
          </p>
          {photographer && <div className="mt-2"><AddressActions address={job?.map_query ?? r.address} /></div>}
        </div>
        <span className={cx("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_STYLES[r.status])}>
          {photographer && r.status === "delivered" ? "Delivered" : REQUEST_STATUS_LABELS[r.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.needs.map((n) => (
          <span key={n} className="rounded-full bg-soft px-3 py-1 text-sm">{NEED_LABELS[n] ?? n}</span>
        ))}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {due && <Item label="Needed by" value={due} />}
        {r.scheduled_for && <Item label="Shoot" value={whenCentral(r.scheduled_for)} />}
        {!photographer && <Item label="Photographer" value={r.photographer_name ?? "Not assigned yet"} />}
        <Item label="Requested by" value={r.requester_name ?? "Someone"} />
      </dl>
      {r.notes && <p className="mt-3 rounded-xl bg-soft px-3 py-2 text-sm"><b className="font-semibold">Notes:</b> {r.notes}</p>}
      {r.photographer_note && <p className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm"><b className="font-semibold">From the photographer:</b> {r.photographer_note}</p>}
      {photographer && job && <JobContacts job={job} team={team} />}

      {children}

      {open && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          {admin && (
            <form action={updateMediaRequest} className="flex flex-wrap items-end gap-2">
              <Hidden r={r} op="assign" back={back} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Photographer</span>
                <select name="photographer_id" defaultValue={r.photographer_id ?? ""} className="field-input py-2 text-sm">
                  <option value="">Not assigned</option>
                  {(photographers ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Shoot date</span>
                <input type="date" name="date" className="field-input py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Time (Central)</span>
                <input type="time" name="time" defaultValue="09:00" className="field-input py-2 text-sm" />
              </label>
              <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Save</button>
            </form>
          )}

          {photographer && ["assigned", "scheduled"].includes(r.status) && (
            <>
              <form action={updateMediaRequest} className="flex flex-wrap items-end gap-2">
                <Hidden r={r} op="schedule" back={back} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Shoot date</span>
                  <input type="date" name="date" required className="field-input py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Time (Central)</span>
                  <input type="time" name="time" required defaultValue="09:00" className="field-input py-2 text-sm" />
                </label>
                <button className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-soft">
                  {r.scheduled_for ? "Reschedule" : "Set shoot time"}
                </button>
              </form>
              <Link href={`/media/upload?request=${r.id}`} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Upload photos or video
              </Link>
              <form action={updateMediaRequest} className="flex w-full flex-wrap items-end gap-2">
                <Hidden r={r} op="deliver" back={back} />
                <input name="note" placeholder="Note for the builder (optional)" className="field-input min-w-0 flex-1 py-2 text-sm" />
                <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">Mark delivered</button>
              </form>
            </>
          )}
          {photographer && r.status === "delivered" && (
            <Link href={`/media/upload?request=${r.id}`} className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-soft">
              Add more files
            </Link>
          )}

          {(builderTeam || admin) && r.status === "delivered" && (
            <>
              <form action={updateMediaRequest}>
                <Hidden r={r} op="complete" back={back} />
                <button className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Looks good, mark complete</button>
              </form>
              <form action={updateMediaRequest}>
                <Hidden r={r} op="redo" back={back} />
                <button className="rounded-lg border border-foreground px-3 py-2 text-sm font-semibold hover:bg-soft">Needs another pass</button>
              </form>
            </>
          )}
          {r.home_id && !photographer && ["delivered", "scheduled", "assigned"].includes(r.status) && (
            <Link href={`/media?home=${r.home_id}`} className="text-sm font-semibold underline">See the home’s media</Link>
          )}
          {(builderTeam || admin) && (
            <form action={updateMediaRequest} className="ml-auto">
              <Hidden r={r} op="cancel" back={back} />
              <button className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 underline hover:bg-red-50">Cancel request</button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

// Who to call about this job.
function JobContacts({ job, team }: { job: JobInfo; team?: { email: string | null; phone: string | null } }) {
  const builder = job.builder_name.replace(" (demo)", "");
  return (
    <details className="group mt-4 rounded-xl border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold hover:bg-soft">
        Questions or a problem at the home?
        <span className="text-muted transition-transform group-open:rotate-180" aria-hidden>▾</span>
      </summary>
      <div className="border-t border-line p-3">
      {job.access_notes && <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950"><b className="font-semibold">Getting in:</b> {job.access_notes}</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <Contact
          heading={`${builder} shoot contact`}
          name={job.builder_contact_name}
          phone={job.builder_contact_phone}
          email={job.builder_contact_email}
          empty="Not set yet. Call our team."
        />
        <Contact heading="Requested by" name={job.requester_name} detail={job.requester_title} phone={job.requester_phone} email={job.requester_email} empty="Not available" />
        <Contact heading="Our team (scheduling, pay)" name="Builder Listings" phone={team?.phone ?? null} email={team?.email ?? null} empty="" />
      </div>
      </div>
    </details>
  );
}

function Contact({ heading, name, detail, phone, email, empty }: { heading: string; name: string | null; detail?: string | null; phone: string | null; email: string | null; empty: string }) {
  const tel = phone?.replace(/[^\d+]/g, "");
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{heading}</p>
      {name || phone || email ? (
        <>
          {name && <p className="font-medium">{name}{detail ? <span className="font-normal text-muted">, {detail}</span> : null}</p>}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {phone && <a href={`tel:${tel}`} className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-white">Call {phone}</a>}
            {phone && <a href={`sms:${tel}`} className="rounded-full border border-line px-3 py-1 text-xs font-semibold">Text</a>}
            {email && <a href={`mailto:${email}`} className="rounded-full border border-line px-3 py-1 text-xs font-semibold">Email</a>}
          </div>
        </>
      ) : (
        <p className="text-muted">{empty}</p>
      )}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted">{label}:</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

// The "request photos" form. Either fixed to one home, or with a picker.
export function RequestForm({
  back,
  homeId,
  targets,
}: {
  back: string;
  homeId?: string;
  targets?: { communities: { id: string; name: string }[]; homes: { id: string; community_id: string; unparsed_address: string }[] };
}) {
  return (
    <form action={createMediaRequest} className="rounded-2xl bg-soft p-5">
      <input type="hidden" name="back" value={back} />
      {homeId ? (
        <input type="hidden" name="target" value={`home:${homeId}`} />
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">What should be shot?</span>
          <select name="target" required defaultValue="" className="field-input">
            <option value="" disabled>Choose a home or community</option>
            {(targets?.communities ?? []).map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={`community:${c.id}`}>{c.name}: whole community (amenities, entrance, aerials)</option>
                {(targets?.homes ?? []).filter((h) => h.community_id === c.id).map((h) => (
                  <option key={h.id} value={`home:${h.id}`}>{h.unparsed_address}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <fieldset className={homeId ? "" : "mt-4"}>
        <legend className="mb-2 text-sm font-medium">What do you need?</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(NEED_LABELS).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="needs" value={k} defaultChecked={k === "photos"} className="h-4 w-4 accent-[#3452c7]" />
              {v}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Needed by</span>
          <input type="date" name="due_date" className="field-input" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Notes for the photographer</span>
          <input name="notes" placeholder="Staging is in Saturday; get the new landscaping" className="field-input" />
        </label>
      </div>
      <button className="mt-4 rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Request photos</button>
    </form>
  );
}

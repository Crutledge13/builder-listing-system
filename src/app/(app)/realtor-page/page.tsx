import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canEditBranding, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { BackButton } from "@/components/back-button";
import { dateTime } from "@/lib/format";
import { SHARE_DEFAULTS, SHARE_SELECT, SHARE_SWITCHES, type ShareSettings } from "@/lib/share-settings";
import { saveShareSettings } from "./actions";

// Realtor page settings: what every home's realtor share link shows, for the
// whole builder. Owners, managers, marketing and our admins change it; everyone
// else at the builder (and our coordinators) can see what's on.
export default function RealtorPageSettings(props: PageProps<"/realtor-page">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Settings searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Settings({ searchParams }: { searchParams: PageProps<"/realtor-page">["searchParams"] }) {
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const staff = isStaff(me.role);
  const sp = await searchParams;
  const supabase = await createClient();

  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : null) : me.builder_id;
  if (!builderId) {
    if (!staff) redirect("/communities");
    const { data: builders } = await supabase.from("builders").select("id, name").order("name");
    return (
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Realtor page settings</h1>
        <p className="mt-1 text-muted">Pick a builder.</p>
        <ul className="mt-6 divide-y divide-line rounded-2xl border border-line">
          {(builders ?? []).map((b) => (
            <li key={b.id}><Link href={`/realtor-page?builder=${b.id}`} className="block px-4 py-3 font-medium hover:bg-soft">{b.name.replace(" (demo)", "")}</Link></li>
          ))}
        </ul>
      </div>
    );
  }

  const [{ data: builder }, { data: row }] = await Promise.all([
    supabase.from("builders").select("id, name").eq("id", builderId).maybeSingle(),
    supabase.from("share_page_settings").select(SHARE_SELECT).eq("builder_id", builderId).maybeSingle(),
  ]);
  if (!builder) redirect("/communities");
  const current = { ...SHARE_DEFAULTS, ...((row ?? {}) as Partial<ShareSettings>) };
  const updatedAt = (row as { updated_at?: string } | null)?.updated_at;
  const edit = me.role === "platform_admin" || (!staff && canEditBranding(me.role));
  const name = builder.name.replace(" (demo)", "");
  const groups = [...new Set(SHARE_SWITCHES.map((s) => s.group))];

  return (
    <div data-back-name="Realtor page settings">
      <BackButton href="/homes" label="Back" onlyWithTrail />
      <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">Realtor page settings</h1>
      <p className="mt-1 text-muted">
        What every {staff ? `${name} ` : ""}home&rsquo;s realtor share link shows. Changes apply to all homes right away, including links already sent.
        Sections with nothing in them stay hidden on their own.
      </p>
      <div className="mt-6"><Notice searchParams={searchParams} /></div>

      <form action={saveShareSettings} className="space-y-6">
        <input type="hidden" name="builder_id" value={builderId} />
        {groups.map((g) => (
          <fieldset key={g} className="rounded-2xl border border-line">
            <legend className="sr-only">{g}</legend>
            <p className="border-b border-line px-5 py-3 text-sm font-semibold">{g}</p>
            <ul className="divide-y divide-line">
              {SHARE_SWITCHES.filter((s) => s.group === g).map((s) => (
                <li key={s.key}>
                  <label className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 has-[:disabled]:cursor-default">
                    <span className="min-w-0">
                      <span className="block font-medium">{s.label}</span>
                      <span className="mt-0.5 block text-sm text-muted">{s.help}</span>
                    </span>
                    <span className="relative mt-0.5 inline-flex shrink-0">
                      <input type="checkbox" name={s.key} defaultChecked={current[s.key]} disabled={!edit} className="peer sr-only" />
                      <span aria-hidden className="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-disabled:opacity-60" />
                      <span aria-hidden className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        {edit ? (
          <div className="flex flex-wrap items-center gap-4">
            <button className="rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save settings</button>
            {updatedAt && row && <span className="text-sm text-muted">Last changed {dateTime(updatedAt)}</span>}
          </div>
        ) : (
          <p className="text-sm text-muted">Marketing, managers and owners change these.</p>
        )}
      </form>
      <p className="mt-8 text-sm text-muted">
        To see the result, open any home and click <b className="font-semibold text-foreground">See what the realtor sees</b> under Share with a realtor.
      </p>
    </div>
  );
}

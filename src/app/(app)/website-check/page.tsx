import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { builderFocus } from "@/lib/builder-focus";
import { requireProfile } from "@/lib/auth";
import { requireFeature } from "@/lib/features";
import { canAddHomes, canSeeWebsiteCheck, editableFields, isStaff, type HomeField, type WorkflowStatus } from "@/lib/permissions";
import { cx, dateTime, money, num } from "@/lib/format";
import { Notice } from "@/components/notice";
import { MarketBadge, StatusBadge } from "@/components/badges";
import { COMPARE_FIELDS, normalize, type CompareKey } from "./fields";
import { addFromWebsite, askToFixMls, dismissWebsiteListing, linkWebsiteMatch, saveFeedSettings, syncFeedNow, useWebsiteValue } from "./actions";
import { PendingButton } from "@/components/pending-button";

export default function WebsiteCheckPage(props: PageProps<"/website-check">) {
  return (
    <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Check searchParams={props.searchParams} />
    </Suspense>
  );
}

type Row = Record<string, unknown> & { id: string; unparsed_address: string };

const SOURCE_NAMES: Record<string, string> = {
  listing_feed: "Listing feed from the website (best)",
  website_platform: "Website platform connection",
  page_reader: "Read the website’s home pages",
  spreadsheet: "Spreadsheet the builder sends",
};

function show(key: CompareKey, v: unknown) {
  if (v === null || v === undefined || v === "") return <span className="text-muted">—</span>;
  if (key === "list_price") return money(v as number);
  if (key === "living_area") return num(v as number);
  return String(v);
}

async function Check({ searchParams }: { searchParams: PageProps<"/website-check">["searchParams"] }) {
  const me = await requireProfile();
  await requireFeature(me, "website_check");
  if (!canSeeWebsiteCheck(me.role)) redirect("/communities");
  const sp = await searchParams;
  const staff = isStaff(me.role);
  const tab = sp.tab === "new" || sp.tab === "feed" ? sp.tab : "compare";
  const showAll = sp.all === "1";
  const supabase = await createClient();

  const { data: builders } = staff ? await supabase.from("builders").select("id, name").order("name") : { data: null };
  // Our team: the builder picked on this page, else the one picked in the top bar, else the first.
  const focus = await builderFocus(me.role);
  const builderId = staff ? (typeof sp.builder === "string" ? sp.builder : focus ?? builders?.[0]?.id) : me.builder_id;
  if (!builderId) return <p className="text-muted">No builders yet.</p>;
  const builderName = staff ? builders?.find((b) => b.id === builderId)?.name : me.builder_name;

  const [{ data: settings }, { data: web }, { data: mls }, { data: homes }, { data: communities }] = await Promise.all([
    supabase.from("builder_settings").select("*").eq("builder_id", builderId).maybeSingle(),
    supabase.from("website_listings").select("*").eq("builder_id", builderId).is("dismissed_at", null).order("unparsed_address"),
    supabase.from("mls_listings").select("*").eq("builder_id", builderId),
    supabase
      .from("homes")
      .select("id, unparsed_address, community_id, workflow_status, market_status, mls_number, list_price, bedrooms_total, bathrooms_full, bathrooms_half, living_area, public_remarks, communities(name)")
      .eq("builder_id", builderId)
      .is("deleted_at", null)
      .order("unparsed_address"),
    supabase.from("communities").select("id, name").eq("builder_id", builderId).order("name"),
  ]);
  const webByHome = new Map((web ?? []).filter((w) => w.home_id).map((w) => [w.home_id as string, w as Row]));
  const mlsByHome = new Map((mls ?? []).filter((m) => m.home_id).map((m) => [m.home_id as string, m as Row]));
  const newOnWebsite = (web ?? []).filter((w) => !w.home_id);
  // Website homes that look like homes already added by hand (same address): confirm to link them.
  const { data: suggestionRows } = await supabase.rpc("website_link_suggestions");
  const homeIds = new Set((homes ?? []).map((h) => h.id));
  const matches = ((suggestionRows ?? []) as { website_listing_id: string; home_id: string; address: string; website_url: string | null; community_name: string | null }[])
    .filter((m) => homeIds.has(m.home_id));
  const matchedListing = new Map(matches.map((m) => [m.website_listing_id, m]));
  const canLink = ["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role);
  const myFields = new Set(editableFields(me.role) as readonly HomeField[]);
  const canApprove = ["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role);
  const canManageFeed = ["platform_admin", "builder_owner", "manager", "marketing"].includes(me.role);

  // Line up each home: website | Builder Listings | MLS.
  const checked = (homes ?? []).map((h) => {
    const w = webByHome.get(h.id);
    const m = mlsByHome.get(h.id);
    const rows = COMPARE_FIELDS.map((f) => {
      const ours = normalize(f.key, (h as Row)[f.key]);
      const site = w ? normalize(f.key, w[f.key]) : null;
      const onMls = m ? normalize(f.key, m[f.key]) : null;
      return {
        ...f,
        ours: (h as Row)[f.key],
        site: w?.[f.key],
        onMls: m?.[f.key],
        webDiff: !!w && site !== null && site !== ours,
        mlsDiff: !!m && onMls !== ours,
      };
    });
    const issues = rows.filter((r) => r.webDiff || r.mlsDiff).length + (h.workflow_status === "live_on_mls" && !m ? 1 : 0);
    return { h, w, m, rows, issues };
  });
  const withIssues = checked.filter((c) => c.issues > 0);
  const notOnWebsite = checked.filter((c) => !c.w).length;
  const list = showAll ? checked : withIssues;

  const href = (p: Record<string, string>) => {
    const s = new URLSearchParams(staff ? { builder: builderId } : {});
    Object.entries(p).forEach(([k, v]) => v && s.set(k, v));
    const str = s.toString();
    return str ? `/website-check?${str}` : "/website-check";
  };
  const backTo = href({ tab: tab === "compare" ? "" : tab, all: showAll ? "1" : "" });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Website check</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Lines up {staff ? `${builderName?.replace(" (demo)", "")}’s` : "your"} website, Builder Listings and the MLS so every price, bed, bath and square foot matches.
          </p>
        </div>
        {staff && builders && (
          <form action="/website-check" className="flex items-center gap-2">
            <select name="builder" defaultValue={builderId} className="field-input py-2" aria-label="Builder">
              {builders.map((b) => <option key={b.id} value={b.id}>{b.name.replace(" (demo)", "")}</option>)}
            </select>
            <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-foreground">Show</button>
          </form>
        )}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Homes checked", value: checked.length },
          { label: "Need attention", value: withIssues.length, warn: withIssues.length > 0 },
          { label: "New on website", value: newOnWebsite.length, warn: newOnWebsite.length > 0 },
          { label: "Not on website", value: notOnWebsite },
        ].map((s) => (
          <div key={s.label} className={cx("rounded-2xl border p-4", s.warn ? "border-amber-300 bg-amber-50/50" : "border-line")}>
            <dt className="text-sm text-muted">{s.label}</dt>
            <dd className="text-2xl font-bold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-line">
        {[
          { v: "compare", label: "Compare" },
          { v: "new", label: `New on website${newOnWebsite.length ? ` (${newOnWebsite.length})` : ""}` },
          { v: "feed", label: "Website feed" },
        ].map((t) => (
          <Link
            key={t.v}
            href={href({ tab: t.v === "compare" ? "" : t.v })}
            className={cx("-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold", tab === t.v ? "border-foreground" : "border-transparent text-muted hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!settings?.website_feed_enabled && tab !== "feed" && (
        <p className="mt-6 rounded-xl bg-soft px-4 py-3 text-sm">
          The website feed is off, so there’s no website data to compare yet. {canManageFeed ? <Link href={href({ tab: "feed" })} className="font-semibold underline">Turn it on</Link> : "Ask an owner or manager to turn it on."}
          {" "}The MLS column still checks against the MLS.
        </p>
      )}

      {tab === "compare" && (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">{showAll ? `All ${checked.length} homes` : withIssues.length ? `${withIssues.length} homes don’t match` : "Everything matches."}</span>
            <Link href={href({ all: showAll ? "" : "1" })} className="font-semibold underline">{showAll ? "Only show differences" : "Show every home"}</Link>
          </div>
          <div className="space-y-4">
            {list.map(({ h, w, m, rows, issues }) => {
              const mlsSummary = rows.filter((r) => r.mlsDiff).map((r) => `${r.label}: MLS shows ${normalize(r.key, r.onMls) ?? "nothing"}, Builder Listings has ${normalize(r.key, r.ours) ?? "nothing"}`).join("\n");
              return (
                <article key={h.id} className={cx("rounded-2xl border p-4", issues ? "border-amber-300" : "border-line")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/homes/${h.id}`} className="mr-auto font-semibold hover:underline">
                      {h.unparsed_address} <span className="font-normal text-muted">{(h.communities as unknown as { name: string } | null)?.name}</span>
                    </Link>
                    <StatusBadge status={h.workflow_status as WorkflowStatus} />
                    <MarketBadge status={h.market_status} />
                    {issues === 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">All match</span>}
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          <th className="py-1.5 pr-3 font-medium">Field</th>
                          <th className="py-1.5 pr-3 font-medium">Website {w?.url ? <a href={String(w.url)} target="_blank" rel="noreferrer" className="underline">(page)</a> : null}</th>
                          <th className="py-1.5 pr-3 font-medium">Builder Listings</th>
                          <th className="py-1.5 font-medium">MLS {m ? `#${m.listing_id}` : ""}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {rows.filter((r) => showAll || r.webDiff || r.mlsDiff).map((r) => (
                          <tr key={r.key} className="align-top">
                            <td className="py-2 pr-3 font-medium">{r.label}</td>
                            <td className={cx("py-2 pr-3", r.webDiff && "bg-amber-50 font-semibold text-amber-900")}>
                              {w ? show(r.key, r.site) : <span className="text-muted">Not on website</span>}
                              {r.webDiff && myFields.has(r.key) && (
                                <form action={useWebsiteValue} className="mt-1">
                                  <input type="hidden" name="back" value={backTo} />
                                  <input type="hidden" name="home_id" value={h.id} />
                                  <input type="hidden" name="field" value={r.key} />
                                  <button className="text-xs font-semibold text-accent underline">Use website value</button>
                                </form>
                              )}
                            </td>
                            <td className="py-2 pr-3">{show(r.key, r.ours)}</td>
                            <td className={cx("py-2", r.mlsDiff && "bg-red-50 font-semibold text-red-800")}>
                              {m ? show(r.key, r.onMls) : <span className="text-muted">{h.workflow_status === "live_on_mls" ? "Not found on MLS" : "Not on MLS yet"}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {h.workflow_status === "live_on_mls" && !m && (
                    <p className="mt-2 text-sm text-red-800">Marked live here, but the MLS feed doesn’t show MLS #{h.mls_number}. Our team should check it.</p>
                  )}
                  {mlsSummary && (
                    <form action={askToFixMls} className="mt-3">
                      <input type="hidden" name="back" value={backTo} />
                      <input type="hidden" name="home_id" value={h.id} />
                      <input type="hidden" name="builder_id" value={builderId} />
                      <input type="hidden" name="address" value={h.unparsed_address} />
                      <input type="hidden" name="summary" value={mlsSummary} />
                      <button className="rounded-lg bg-foreground px-3 py-2 text-sm font-semibold text-white hover:bg-black">
                        {staff ? "Add a task to fix the MLS" : "Ask our team to fix the MLS"}
                      </button>
                    </form>
                  )}
                </article>
              );
            })}
            {list.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
                <p className="font-semibold">Everything matches</p>
                <p className="mt-1 text-muted">Website, Builder Listings and the MLS agree on every home.</p>
              </div>
            )}
          </div>
          <p className="mt-6 text-xs text-muted">
            Website data last read {settings?.website_feed_last_synced_at ? dateTime(settings.website_feed_last_synced_at) : "never"}. MLS data comes from the MLS’s read-only feed; we never send anything to the MLS.
          </p>
        </div>
      )}

      {tab === "new" && (
        <div className="mt-6">
          <p className="max-w-2xl text-sm text-muted">
            Homes on the website that aren’t in Builder Listings yet. One click brings over the address, plan, price, beds, baths, square feet and description.
            You’ll add the MLS-only details (lot, school district, photos) after.
          </p>
          {matches.length > 0 && (
            <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
              <h3 className="font-semibold">Already added? These look like the same home</h3>
              <p className="mt-1 text-sm text-muted">
                Same address on your website and in Builder Listings, but not linked. Linking ties the home to its website page, so the
                website check compares them and the realtor share page&rsquo;s &ldquo;More info&rdquo; button goes to that page.
              </p>
              <ul className="mt-3 divide-y divide-amber-200">
                {matches.map((m) => (
                  <li key={m.website_listing_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <Link href={`/homes/${m.home_id}`} className="font-semibold underline">{m.address}</Link>
                      {m.community_name && <span className="text-sm text-muted"> · {m.community_name}</span>}
                      {m.website_url && (
                        <a href={m.website_url} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-muted underline">{m.website_url.replace(/^https?:\/\//, "")}</a>
                      )}
                    </span>
                    {canLink && (
                      <form action={linkWebsiteMatch}>
                        <input type="hidden" name="back" value={backTo} />
                        <input type="hidden" name="home_id" value={m.home_id} />
                        <input type="hidden" name="website_listing_id" value={m.website_listing_id} />
                        <PendingButton pending="Linking…" className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-semibold text-white hover:bg-black">Link them</PendingButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {newOnWebsite.map((w) => {
              const match = (communities ?? []).find((c) => c.name.toLowerCase() === String(w.community_name ?? "").toLowerCase());
              return (
                <article key={w.id} className="rounded-2xl border border-line p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{w.unparsed_address}</h3>
                      {matchedListing.has(w.id) && (
                        <p className="text-xs font-semibold text-amber-800">Looks like a home you already added. Link it above instead of adding it again.</p>
                      )}
                      <p className="text-sm text-muted">{w.community_name}, {w.city}. {w.plan_name} plan. {w.status_text}</p>
                    </div>
                    <span className="text-lg font-bold tabular-nums">{money(w.list_price)}</span>
                  </div>
                  <p className="mt-2 text-sm">
                    <b>{w.bedrooms_total ?? "—"}</b> bd, <b>{(w.bathrooms_full ?? 0) + (w.bathrooms_half ?? 0) * 0.5}</b> ba, <b>{num(w.living_area)}</b> sq ft
                  </p>
                  {w.public_remarks && <p className="mt-2 line-clamp-3 text-sm text-muted">{w.public_remarks}</p>}
                  {canAddHomes(me.role) ? (
                    <form action={addFromWebsite} className="mt-4 space-y-3">
                      <input type="hidden" name="back" value={backTo} />
                      <input type="hidden" name="listing_id" value={w.id} />
                      <select name="community_id" defaultValue={match?.id ?? ""} required className="field-input py-2" aria-label="Community">
                        <option value="" disabled>Which community?</option>
                        {(communities ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="flex flex-wrap gap-2">
                        <button name="mode" value="send" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">{canApprove ? "Push it live" : "Add and send for approval"}</button>
                        <button name="mode" value="draft" className="rounded-lg border border-foreground px-4 py-2 text-sm font-semibold hover:bg-soft">Add as a draft</button>
                      </div>
                      <p className="text-xs text-muted">
                        {canApprove
                          ? "“Push it live” adds and approves it, so our team enters it into the MLS. It isn’t sent to the MLS automatically."
                          : "Adds it and sends it to a manager or owner to approve for the MLS."}
                      </p>
                    </form>
                  ) : (
                    <p className="mt-4 text-sm text-muted">Ask your manager or marketing team to add this home.</p>
                  )}
                  {canAddHomes(me.role) && (
                    <form action={dismissWebsiteListing} className="mt-2">
                      <input type="hidden" name="back" value={backTo} />
                      <input type="hidden" name="listing_id" value={w.id} />
                      <button className="text-xs text-muted underline">Not a listing, hide it</button>
                    </form>
                  )}
                </article>
              );
            })}
            {newOnWebsite.length === 0 && <p className="rounded-2xl border border-dashed border-line px-6 py-12 text-center text-muted lg:col-span-2">Nothing new on the website.</p>}
          </div>
        </div>
      )}

      {tab === "feed" && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
          <form action={saveFeedSettings} className="space-y-4 rounded-2xl border border-line p-5">
            <input type="hidden" name="back" value={href({ tab: "feed" })} />
            <input type="hidden" name="builder_id" value={builderId} />
            <h2 className="text-lg font-semibold">Website feed</h2>
            <p className="text-sm text-muted">
              Optional. When it’s on, we read the homes on your website every day and show them here. Nothing on your site changes, and nothing overwrites your team’s edits:
              new homes wait on the “New on website” tab, and differences wait on “Compare” for someone to choose.
            </p>
            <fieldset disabled={!canManageFeed} className="space-y-4 disabled:opacity-70">
              <label className="flex items-center gap-3 rounded-xl border border-line p-3">
                <input type="checkbox" name="website_feed_enabled" defaultChecked={!!settings?.website_feed_enabled} className="h-5 w-5 accent-[#3452c7]" />
                <span className="font-medium">Turn on the website feed</span>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Website address</span>
                <input name="website_url" type="url" defaultValue={settings?.website_url ?? ""} placeholder="https://www.yourbuilder.com" className="field-input" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">How we read it</span>
                <select name="website_feed_source" defaultValue={settings?.website_feed_source ?? "listing_feed"} className="field-input">
                  {Object.entries(SOURCE_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {canManageFeed && <button className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-white hover:brightness-110">Save</button>}
            </fieldset>
            {!canManageFeed && <p className="text-sm text-muted">An owner or manager can change these settings.</p>}
          </form>
          <div className="h-fit space-y-3 rounded-2xl bg-soft p-5 text-sm">
            <p><b>Status:</b> {settings?.website_feed_enabled ? "On" : "Off"}</p>
            <p><b>Last read:</b> {settings?.website_feed_last_synced_at ? dateTime(settings.website_feed_last_synced_at) : "Never"}</p>
            <p><b>Homes found:</b> {(web ?? []).length}</p>
            {settings?.website_feed_enabled && canManageFeed && (
              <form action={syncFeedNow}>
                <input type="hidden" name="back" value={href({ tab: "feed" })} />
                <input type="hidden" name="builder_id" value={builderId} />
                <button className="w-full rounded-lg border border-foreground bg-white px-3 py-2 font-semibold hover:bg-soft">Check the website now</button>
              </form>
            )}
            <p className="text-xs text-muted">Compared: price, beds, baths and square feet. New homes also bring over the description, plan and status. Everything else comes from your team.</p>
          </div>
        </div>
      )}
    </div>
  );
}

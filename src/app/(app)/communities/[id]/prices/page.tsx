import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, sendPhotographersToJobs } from "@/lib/auth";
import { canBulkChangePrices, MARKET_LABELS, STATUS_LABELS, type MarketStatus, type WorkflowStatus } from "@/lib/permissions";
import { BackButton } from "@/components/back-button";
import { Notice } from "@/components/notice";
import { BulkPriceForm, type BulkHome } from "@/components/bulk-price-form";
import { bulkChangePrices } from "./actions";

// Change many prices in a community at once (owners, 29 Oct 2026).
export default function CommunityPricesPage(props: PageProps<"/communities/[id]/prices">) {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<div className="mt-16 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <Notice searchParams={props.searchParams} />
        <Prices params={props.params} />
      </Suspense>
    </div>
  );
}

async function Prices({ params }: { params: PageProps<"/communities/[id]/prices">["params"] }) {
  const { id } = await params;
  const me = await requireProfile();
  sendPhotographersToJobs(me);
  const supabase = await createClient();
  const { data: community } = await supabase.from("communities").select("id, name").eq("id", id).maybeSingle();
  if (!community) notFound();
  if (!canBulkChangePrices(me.role)) {
    return (
      <>
        <BackButton href={`/communities/${id}`} label={community.name} />
        <p className="mt-6 text-muted">Owners, managers and marketing change prices. Salespeople can send a price change request from each home.</p>
      </>
    );
  }
  const { data } = await supabase
    .from("homes")
    .select("id, unparsed_address, plan_name, list_price, workflow_status, market_status")
    .eq("community_id", id)
    .is("deleted_at", null)
    .order("unparsed_address");
  const homes: BulkHome[] = (data ?? []).map((h) => {
    const market = (h.market_status ?? null) as MarketStatus | null;
    const closed = market === "sold" || market === "under_contract" || market === "withdrawn";
    return {
      id: h.id,
      address: h.unparsed_address,
      plan: h.plan_name,
      price: h.list_price === null ? null : Number(h.list_price),
      status: market && market !== "active" ? MARKET_LABELS[market] : STATUS_LABELS[h.workflow_status as WorkflowStatus],
      live: h.workflow_status === "live_on_mls",
      picked: !closed,
    };
  });

  return (
    <>
      <BackButton href={`/communities/${id}`} label={community.name} />
      <h1 className="mt-4 text-[28px] font-bold leading-tight tracking-tight">Change prices in {community.name}</h1>
      <p className="mt-1 text-muted">Pick the homes, say how much, and check the new prices before you save. Every picked home changes at once, or none do.</p>
      {homes.length ? <BulkPriceForm action={bulkChangePrices} communityId={id} homes={homes} /> : <p className="mt-8 text-muted">No homes in this community yet.</p>}
    </>
  );
}

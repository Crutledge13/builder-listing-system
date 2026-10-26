import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HomeArt } from "@/components/home-art";

export default function MediaPage(props: PageProps<"/media">) {
  return (
    <Suspense fallback={<div className="mx-auto mt-16 h-64 max-w-2xl animate-pulse rounded-2xl bg-soft" />}>
      <Media searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Media({ searchParams }: { searchParams: PageProps<"/media">["searchParams"] }) {
  const sp = await searchParams;
  const homeId = typeof sp.home === "string" ? sp.home : null;
  const communityId = typeof sp.community === "string" ? sp.community : null;
  const supabase = await createClient();

  // Look up what we're showing media for. Access rules apply: other builders'
  // homes and communities simply don't come back.
  let title = "Media library";
  let backHref: string | null = null;
  let backLabel = "";
  if (homeId) {
    const { data } = await supabase.from("homes").select("unparsed_address").eq("id", homeId).maybeSingle();
    if (data) {
      title = `Photos and video for ${data.unparsed_address}`;
      backHref = `/homes/${homeId}`;
      backLabel = "Back to the home";
    }
  } else if (communityId) {
    const { data } = await supabase.from("communities").select("name").eq("id", communityId).maybeSingle();
    if (data) {
      title = `${data.name} community media`;
      backHref = `/communities/${communityId}`;
      backLabel = `Back to ${data.name}`;
    }
  }

  return (
    <div className="mx-auto max-w-2xl py-10 text-center">
      {backHref && (
        <Link href={backHref} className="text-sm font-medium text-muted hover:text-foreground">{backLabel}</Link>
      )}
      <div className="mx-auto mt-6 grid max-w-md grid-cols-3 gap-2 overflow-hidden rounded-2xl opacity-80">
        {["m1", "m2", "m3"].map((s, i) => (
          <HomeArt key={s} seed={(homeId ?? communityId ?? "") + s} stories={i === 1 ? 2 : 1} className="aspect-square w-full" />
        ))}
      </div>
      <h1 className="mt-8 text-[28px] font-bold tracking-tight">{title}</h1>
      <p className="mx-auto mt-3 max-w-lg text-muted">
        {homeId
          ? "This is where this home’s photos, videos and floor plans will live, ready to download one at a time or as an MLS photo pack."
          : communityId
            ? "This is where the community’s shared media will live: amenity photos, drone shots, site maps and model-home tours, usable on any home in the community."
            : "Photos and videos for every home, organized by community and room, searchable, and ready to download as an MLS photo pack."}
      </p>
      <p className="mx-auto mt-4 max-w-lg rounded-xl bg-soft px-4 py-3 text-sm text-muted">
        The media library is the next thing we’re building. It turns on once photo storage is connected.
      </p>
    </div>
  );
}

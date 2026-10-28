// Ready-to-use social post ideas for a home, written from its own details
// (status, price, beds, baths, square feet, community, incentives, open
// houses). Made on the fly each time the realtor page opens, so they always
// match the home as it is now; no AI and no credits. Shown on the realtor
// share page with copy buttons.

export type PostIdea = { title: string; text: string; pair: "reel" | "photos" | "photo" };

type Home = {
  address: string; city: string; plan_name: string | null; list_price: number | null;
  bedrooms_total: number | null; bathrooms_full: number | null; bathrooms_half: number | null;
  living_area: number | null; build_stage: string; estimated_completion: string | null; market_status: string | null;
};
type Incentive = { title: string; ends_on: string };
type OpenHouse = { starts_at: string; ends_at: string };

const TZ = "America/Chicago";
const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const tag = (s: string) => "#" + s.replace(/\(demo\)/i, "").replace(/[^A-Za-z0-9]+/g, "");

function bathText(full: number | null, half: number | null) {
  const n = (full ?? 0) + (half ?? 0) * 0.5;
  return n ? String(n) : null;
}

function readyText(h: Home) {
  if (h.build_stage === "move_in_ready") return "Move-in ready now.";
  if (h.estimated_completion) {
    const [y, m] = h.estimated_completion.split("-").map(Number);
    return `Ready ${new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}.`;
  }
  return h.build_stage === "under_construction" ? "Under construction now." : "";
}

function dayText(o: OpenHouse) {
  const s = new Date(o.starts_at);
  const e = new Date(o.ends_at);
  const day = s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "").toLowerCase();
  return `${day}, ${t(s)} to ${t(e)}`;
}

export function socialPostIdeas(h: Home, community: string, builder: string, opts: { incentives: Incentive[]; openHouses: OpenHouse[]; hasReel: boolean; photoCount: number }): PostIdea[] {
  if (h.market_status === "sold" || h.market_status === "under_contract") return [];
  const specs = [
    h.bedrooms_total != null && `${h.bedrooms_total} bed`,
    bathText(h.bathrooms_full, h.bathrooms_half) && `${bathText(h.bathrooms_full, h.bathrooms_half)} bath`,
    h.living_area != null && `${Math.round(h.living_area).toLocaleString("en-US")} sq ft`,
  ].filter(Boolean).join(", ");
  const tags = [tag(h.city + "TX"), tag(community), "#NewConstruction", "#TexasRealEstate"].join(" ");
  const price = h.list_price != null ? ` Offered at ${money(h.list_price)}.` : "";
  const ideas: PostIdea[] = [];

  ideas.push({
    title: opts.hasReel ? "Post the reel" : "Feature post",
    pair: opts.hasReel ? "reel" : "photo",
    text: `New construction in ${community}! ${h.address} in ${h.city} is a ${specs}${h.plan_name ? ` ${h.plan_name} plan` : " home"} by ${builder.replace(/\s*\(demo\)/i, "")}. ${readyText(h)}${price}\n\nSend me a message for a private showing.\n\n${tags}`.replace(/ \./g, ".").replace(/ {2,}/g, " "),
  });

  const inc = opts.incentives[0];
  if (inc) {
    const [y, m, d] = inc.ends_on.split("-").map(Number);
    const ends = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    ideas.push({
      title: "Builder incentive",
      pair: "photo",
      text: `Builder incentive on ${h.address}: ${inc.title}. Available through ${ends}, so now's the time to see it.\n\n${specs} in ${community}.${price} Ask me how the incentive works for you.\n\n${tags}`,
    });
  }

  const oh = opts.openHouses[0];
  if (oh) {
    ideas.push({
      title: "Open house",
      pair: "photo",
      text: `Open house this ${dayText(oh)} at ${h.address}, ${h.city}. Come walk through this ${specs} new build in ${community}. See you there!\n\n${tags} #OpenHouse`,
    });
  }

  if (ideas.length < 3 && opts.photoCount >= 4) {
    ideas.push({
      title: "Photo carousel",
      pair: "photos",
      text: `Take a look inside ${h.address} in ${community}. Swipe through and tell me your favorite room.\n\n${specs}.${price} ${readyText(h)}\n\n${tags}`.replace(/ {2,}/g, " "),
    });
  }
  return ideas.slice(0, 3);
}

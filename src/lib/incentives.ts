// Incentives: for the whole builder, one community, or one home. Each has an end date.

export type Incentive = {
  id: string;
  builder_id: string;
  community_id: string | null;
  home_id: string | null;
  scope: "builder" | "community" | "home";
  title: string;
  details: string | null;
  ends_on: string; // yyyy-mm-dd
  status: "active" | "ended" | "expired";
};

export const INCENTIVE_SELECT = "id, builder_id, community_id, home_id, scope, title, details, ends_on, status";

export const SCOPE_LABEL: Record<Incentive["scope"], string> = {
  builder: "All communities",
  community: "This community",
  home: "This home",
};

// Today's date in Texas, as yyyy-mm-dd.
export function todayCentral() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}

export function daysLeft(endsOn: string) {
  const [y, m, d] = endsOn.split("-").map(Number);
  const [ty, tm, td] = todayCentral().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

export function endsText(endsOn: string) {
  const [y, m, d] = endsOn.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const left = daysLeft(endsOn);
  return left < 0 ? `Ended ${date}` : left === 0 ? `Ends today (${date})` : left <= 7 ? `Ends in ${left} day${left === 1 ? "" : "s"} (${date})` : `Ends ${date}`;
}

// The active incentives that apply to one home.
export function forHome(list: Incentive[], home: { id: string; builder_id: string; community_id: string | null }) {
  const order = { home: 0, community: 1, builder: 2 } as const;
  return list
    .filter((i) => i.status === "active" && daysLeft(i.ends_on) >= 0 && i.builder_id === home.builder_id)
    .filter((i) => i.scope === "builder" || (i.scope === "community" && i.community_id === home.community_id) || (i.scope === "home" && i.home_id === home.id))
    .sort((a, b) => order[a.scope] - order[b.scope] || a.ends_on.localeCompare(b.ends_on));
}

// The short line on a home card: the most specific incentive, and how many more.
export function cardIncentive(list: Incentive[], home: { id: string; builder_id?: string; community_id?: string | null }) {
  if (!home.builder_id) return undefined;
  const mine = forHome(list, { id: home.id, builder_id: home.builder_id, community_id: home.community_id ?? null });
  return mine.length ? { title: mine[0].title, more: mine.length - 1 } : undefined;
}

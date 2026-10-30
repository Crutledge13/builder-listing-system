import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Our team's ranking of buyers' agents by homes sold (public.buyer_agent_ranking).
export type RankedAgent = {
  agent_key: string;
  agent_name: string;
  agent_mls_id: string | null;
  office_name: string | null;
  homes_sold: number;
  volume: number;
  co_agent_on: number;
  builders: number;
  homes: { home_id: string; address: string; city: string; community: string; county: string; board: string | null; close_date: string | null; close_price: number | null; co: boolean; builder: string }[];
};

export type RankingFilters = { from: string | null; to: string | null; board: string | null; county: string | null; city: string | null };

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

export function readFilters(sp: Record<string, string | string[] | undefined>): RankingFilters {
  return { from: date(sp.from), to: date(sp.to), board: text(sp.board), county: text(sp.county), city: text(sp.city) };
}

export async function loadRanking(supabase: SupabaseClient, f: RankingFilters) {
  const { data, error } = await supabase.rpc("buyer_agent_ranking", {
    p_from: f.from, p_to: f.to, p_board: f.board, p_county: f.county, p_city: f.city,
  });
  return { agents: (data ?? []) as RankedAgent[], error: error?.message ?? null };
}

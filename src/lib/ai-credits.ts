import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// AI credits (migration 20261028000045_ai_credits). Every AI call reserves the
// builder's credits first (public.ai_spend) and then records what it really
// used (public.ai_finish), or gives the credits back if the call failed.
// Work by our team or photographers is logged but doesn't count for the builder.

export type AiKind = "photo_label" | "plan_read" | "brand_guide_read";

export type CreditStatus = {
  month: string;
  allowance: number;
  extra: number;
  used: number;
  left: number;
  costs: Record<AiKind, number>;
  resets_on: string;
};

type Usage = { input_tokens?: number | null; output_tokens?: number | null } | null | undefined;

/** Reserve credits. Returns the usage id, or null when the builder is out of credits. */
export async function spendCredits(supabase: SupabaseClient, builderId: string, kind: AiKind, refId?: string) {
  const { data, error } = await supabase.rpc("ai_spend", { p_builder: builderId, p_kind: kind, p_ref: refId ?? null });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Record the real tokens used (ok) or give the credits back (not ok). Never throws. */
export async function finishCredits(supabase: SupabaseClient, usageId: string, ok: boolean, model?: string, usage?: Usage) {
  await supabase
    .rpc("ai_finish", {
      p_usage: usageId,
      p_ok: ok,
      p_model: model ?? null,
      p_input_tokens: usage?.input_tokens ?? null,
      p_output_tokens: usage?.output_tokens ?? null,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

export async function creditStatus(supabase: SupabaseClient, builderId: string): Promise<CreditStatus | null> {
  const { data } = await supabase.rpc("ai_credit_status", { p_builder: builderId });
  return (data as CreditStatus | null) ?? null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function resetsOn(s: Pick<CreditStatus, "resets_on">) {
  const [, m, d] = s.resets_on.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function outOfCreditsMessage(s: CreditStatus | null) {
  return `Your AI credits for this month are used up${s ? `; they reset ${resetsOn(s)}` : ""}. Ask our team if you need more.`;
}

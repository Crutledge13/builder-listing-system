// The buyer's agent on a home under contract (RESO names). See BuyerAgentFields.
export type BuyerAgent = {
  buyer_agent_full_name?: string | null;
  buyer_office_name?: string | null;
  buyer_agent_mls_id?: string | null;
  buyer_agent_state_license?: string | null;
  co_buyer_agent_full_name?: string | null;
  co_buyer_office_name?: string | null;
  buyer_unrepresented?: boolean | null;
};

// Reads the fields above from a submitted form.
export function readBuyerAgent(formData: FormData) {
  const t = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v ? v.slice(0, 120) : null;
  };
  const unrepresented = formData.get("buyer_unrepresented") === "true";
  return {
    buyer_unrepresented: unrepresented,
    buyer_agent_full_name: unrepresented ? null : t("buyer_agent_full_name"),
    buyer_office_name: unrepresented ? null : t("buyer_office_name"),
    buyer_agent_mls_id: unrepresented ? null : t("buyer_agent_mls_id"),
    buyer_agent_state_license: unrepresented ? null : t("buyer_agent_state_license"),
    co_buyer_agent_full_name: unrepresented ? null : t("co_buyer_agent_full_name"),
    co_buyer_office_name: unrepresented ? null : t("co_buyer_office_name"),
  };
}

// The same, shaped for confirm_availability's p_buyer.
export function buyerAgentForRpc(formData: FormData) {
  const b = readBuyerAgent(formData);
  return {
    unrepresented: b.buyer_unrepresented,
    agent_name: b.buyer_agent_full_name,
    office_name: b.buyer_office_name,
    agent_mls_id: b.buyer_agent_mls_id,
    agent_license: b.buyer_agent_state_license,
    co_agent_name: b.co_buyer_agent_full_name,
    co_office_name: b.co_buyer_office_name,
  };
}

export function missingBuyerAgent(formData: FormData) {
  const b = readBuyerAgent(formData);
  return !b.buyer_unrepresented && (!b.buyer_agent_full_name || !b.buyer_office_name);
}

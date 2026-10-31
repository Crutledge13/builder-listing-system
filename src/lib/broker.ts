import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { assembleMlsSheet, type MlsSheet } from "@/lib/mls-sheet";
import type { MediaRow } from "@/lib/demo-media";
import type { Tour } from "@/lib/listing-media";
import type { MlsBoard, TitleCompany } from "@/lib/mls-fields";
import type { Incentive } from "@/lib/incentives";

// Broker mode: a builder's own outside broker enters its listings in the MLS.
// Brokers only ever use the bare screens under /broker, and they have no access
// to the main tables: everything comes through database functions that first
// check the task belongs to a builder in broker mode that invited them
// (public.broker_tasks, broker_task_sheet, broker_file, ...).

export type BrokerInfo = { full_name: string; terms_at: string | null; builders: string[] };

// The signed-in broker, or off to where they belong. Runs once per page load.
export const requireBroker = cache(async () => {
  const me = await requireProfile();
  if (me.role !== "broker") redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_me");
  const info = (data as BrokerInfo[] | null)?.[0];
  if (!info) redirect("/signed-out?reason=inactive");
  return { me, info };
});

// Same, and they must have accepted the terms of use first.
export async function requireBrokerWithTerms() {
  const b = await requireBroker();
  if (!b.info.terms_at) redirect("/broker/terms");
  return b;
}

export type BrokerTask = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  due_at: string | null;
  created_at: string;
  completed_at: string | null;
  changes: Record<string, { label: string; from: unknown; to: unknown; added?: string[]; removed?: string[] }>;
  checked: string[];
  source_table: string | null;
  source_id: string | null;
  home_id: string | null;
  work_order_no: number;
  submitted_at: string | null;
  submitted_by_name: string | null;
  submitted_mls_number: string | null;
  submitted_mls_url: string | null;
};

// A correction the broker sent back (a field with the right value, or a photo note).
export type BrokerRequest = {
  id: string;
  kind: "field" | "photo";
  field_key: string | null;
  field_label: string | null;
  current_text: string | null;
  proposed_text: string | null;
  media_id: string | null;
  note: string | null;
  status: "open" | "accepted" | "changed" | "declined";
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  resent_at: string | null;
  created_by_name: string;
};

export type BrokerNote = { id: string; body: string; created_at: string; author: string; mine: boolean };
export type BrokerOpenHouse = { id: string; starts_at: string; ends_at: string; remarks: string | null; cancelled_at: string | null };

type Raw = {
  task: BrokerTask;
  builder_name: string;
  notes: BrokerNote[];
  requests?: BrokerRequest[];
  link?: { name: string };
  home?: Parameters<typeof assembleMlsSheet>[0]["home"];
  mls_rows?: { home_id: string | null; community_id: string | null; data: unknown }[];
  board?: MlsBoard | null;
  title?: TitleCompany | null;
  listing?: { id: string; position: number; media: MediaRow | null; tour: Tour | null }[];
  incentives?: Incentive[];
  change_media?: MediaRow[];
  open_houses?: BrokerOpenHouse[];
};

export type BrokerWork = {
  task: BrokerTask;
  builderName: string;
  notes: BrokerNote[];
  requests: BrokerRequest[];
  sheet: MlsSheet | null;
  changeMedia: Map<string, MediaRow>;
  openHouses: BrokerOpenHouse[];
  linkName: string | null;
};

// One work order, built the same way our team's sheet is, from the database's checked answer.
function parseWork(raw: Raw | null): BrokerWork | null {
  if (!raw?.task) return null;
  let sheet: MlsSheet | null = null;
  if (raw.home) {
    const media = (raw.listing ?? []).map((i) => i.media).filter((m): m is MediaRow => !!m);
    const photos = media.filter((m) => m.kind !== "video");
    sheet = assembleMlsSheet({
      home: raw.home,
      rows: raw.mls_rows ?? [],
      listing: {
        photos,
        mlsPhotos: photos.filter((m) => m.mls_ready),
        videos: media.filter((m) => m.kind === "video"),
        tours: (raw.listing ?? []).map((i) => i.tour).filter((t): t is Tour => !!t),
      },
      board: raw.board ?? null,
      incentives: raw.incentives ?? [],
      titleCompany: raw.title ?? null,
    });
  }
  return {
    task: raw.task,
    builderName: raw.builder_name,
    notes: raw.notes ?? [],
    requests: raw.requests ?? [],
    sheet,
    changeMedia: new Map((raw.change_media ?? []).map((m) => [m.id, m])),
    openHouses: raw.open_houses ?? [],
    linkName: raw.link?.name ?? null,
  };
}

// Signed-in broker. Opening it is logged for the builder (once per half hour).
export async function loadBrokerTask(taskId: string): Promise<BrokerWork | null> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_task_sheet", { p_task: taskId });
  return parseWork(data as Raw | null);
}

// One-off link (signed out): the same work order, while the link is live.
export async function loadLinkTask(token: string): Promise<BrokerWork | null> {
  if (!/^[\w-]{20,64}$/.test(token)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("broker_link_sheet", { p_token: token });
  return parseWork(data as Raw | null);
}

export const workOrder = (n: number | null | undefined) => (n ? `WO-${n}` : "");

// Where a broker's photo and video links go: checked against the task each time.
export const brokerFileBase = (taskId: string) => `/broker/file/${taskId}/`;
export const linkFileBase = (token: string) => `/w/${token}/file/`;

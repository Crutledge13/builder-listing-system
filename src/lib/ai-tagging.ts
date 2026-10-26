import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

// Looks at uploaded photos with Claude and suggests the room, a few tags, a
// short caption and anything the MLS might reject. Suggestions are marked as
// coming from AI; a person's change always wins (see migration 0008).
//
// Needs ANTHROPIC_API_KEY on the server. Without it, nothing is sent anywhere.

const MODEL = "claude-haiku-5-5";
const ROOMS = [
  "exterior", "kitchen", "living", "dining", "primary_bedroom", "bedroom", "primary_bath", "bath",
  "backyard", "floor_plan", "amenity", "entrance", "aerial", "site_map", "model_home", "other",
] as const;
const FLAGS = ["blurry", "dark", "people", "signage_or_logo", "text_overlay", "not_a_home_photo"] as const;
// Image types Claude can read. (iPhone HEIC isn't one; those skip AI.)
const READABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type AiSuggestion = {
  room: (typeof ROOMS)[number];
  confidence: number;
  tags: string[];
  caption: string;
  flags: (typeof FLAGS)[number][];
};

export function aiTaggingAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM = `You label photos for a new-construction home builder's private media library.
Look at one photo and reply with only a JSON object, no other text:
{"room": one of ${JSON.stringify(ROOMS)},
 "confidence": number from 0 to 1,
 "tags": up to 6 short lowercase features a buyer's agent would search for (e.g. "quartz countertops", "vaulted ceiling", "covered patio"),
 "caption": a plain description under 12 words, no hype,
 "flags": any of ${JSON.stringify(FLAGS)} that apply, else []}
Room guide: "primary_bedroom" and "primary_bath" are the largest or most finished of their kind; use "bedroom"/"bath" when unsure.
"exterior" is the front or sides of the house; "backyard" is the rear yard or patio. Use "amenity" for community pools, parks or clubhouses,
"aerial" for drone shots, "floor_plan" for drawings of a layout, "other" if nothing fits.`;

// Pull the JSON object out of the model's reply and keep only valid values.
export function parseSuggestion(text: string): AiSuggestion | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const room = ROOMS.includes(raw.room as (typeof ROOMS)[number]) ? (raw.room as AiSuggestion["room"]) : null;
  if (!room) return null;
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => String(t).toLowerCase().trim()).filter((t) => t && t.length <= 40).slice(0, 6)
    : [];
  const caption = typeof raw.caption === "string" ? raw.caption.trim().slice(0, 140) : "";
  const flags = Array.isArray(raw.flags)
    ? (raw.flags.filter((f) => FLAGS.includes(f as (typeof FLAGS)[number])) as AiSuggestion["flags"])
    : [];
  return { room, confidence, tags, caption, flags };
}

const GENERIC_TITLE = /^(img|dsc|dscn|pxl|photo|image|mvimg|screenshot|untitled)[\s_-]*\d*/i;

const ROOM_TITLES: Record<string, string> = {
  exterior: "Front exterior", kitchen: "Kitchen", living: "Living room", dining: "Dining room",
  primary_bedroom: "Primary bedroom", bedroom: "Bedroom", primary_bath: "Primary bath", bath: "Bathroom",
  backyard: "Backyard", floor_plan: "Floor plan", amenity: "Amenity", entrance: "Community entrance",
  aerial: "Aerial view", site_map: "Site plan", model_home: "Model home", other: "Photo",
};

// Tags a batch of media records. Uses the caller's own database connection, so
// it can only change records that person is allowed to change.
export async function tagMedia(supabase: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return;
  const { data: rows } = await supabase
    .from("media")
    .select("id, kind, mime_type, storage_path, source, room, room_source, caption, tags, title")
    .in("id", ids);
  const photos = (rows ?? []).filter((r) => r.source === "upload" && r.kind === "photo" && r.storage_path);

  if (!aiTaggingAvailable()) {
    await supabase.from("media").update({ ai_status: "skipped" }).in("id", photos.map((p) => p.id));
    return;
  }
  const client = new Anthropic();

  const work = photos.map((p) => async () => {
    if (!READABLE.has(p.mime_type ?? "")) {
      await supabase.from("media").update({ ai_status: "skipped" }).eq("id", p.id);
      return;
    }
    try {
      // A short-lived private link just for the AI to read the photo.
      const { data: link } = await supabase.storage.from("media").createSignedUrl(p.storage_path!, 600);
      if (!link) throw new Error("No link");
      const reply = await client.messages.create({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: link.signedUrl } },
              { type: "text", text: "Label this photo." },
            ],
          },
        ],
      });
      const text = reply.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const s = parseSuggestion(text);
      if (!s) throw new Error("Unreadable reply");

      const patch: Record<string, unknown> = {
        ai_status: "done",
        ai_suggestion: s,
        ai_at: new Date().toISOString(),
        tags: [...(p.tags ?? []), ...s.tags],
      };
      // Only fill in what a person hasn't already set.
      if (!p.room || p.room_source === "ai") {
        patch.room = s.room;
        patch.room_source = "ai";
      }
      if (!p.caption && s.caption) {
        patch.caption = s.caption;
        patch.caption_source = "ai";
      }
      if (GENERIC_TITLE.test(p.title ?? "")) patch.title = ROOM_TITLES[s.room] ?? p.title;
      if (s.flags.length) patch.mls_ready = false;
      await supabase.from("media").update(patch).eq("id", p.id);
    } catch {
      await supabase.from("media").update({ ai_status: "failed", ai_at: new Date().toISOString() }).eq("id", p.id);
    }
  });

  // A few at a time, so a big shoot doesn't hit rate limits.
  for (let i = 0; i < work.length; i += 4) {
    await Promise.all(work.slice(i, i + 4).map((w) => w()));
  }
}

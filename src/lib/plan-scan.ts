import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { cleanRooms, ROOM_TYPES, type Room } from "@/lib/rooms";

// Reads a floor plan (PDF or image) with Claude and lists each room with its
// level and size, using NTREIS's room names. Only a suggestion: our team checks
// it before it's saved to the plan. Needs ANTHROPIC_API_KEY on the server.

export const PLAN_MODEL = "claude-sonnet-5-5";
const MODEL = PLAN_MODEL;

export type PlanScan = {
  bedrooms_total: number | null; bathrooms_full: number | null; bathrooms_half: number | null;
  living_area: number | null; stories: number | null; garage_spaces: number | null;
  rooms: Room[];
};

export const planScanAvailable = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = `You read new-home floor plans and list the rooms for an MLS listing.
Reply with only a JSON object, no other text:
{"bedrooms_total": number or null, "bathrooms_full": number or null, "bathrooms_half": number or null,
 "living_area": heated square feet or null, "stories": number or null, "garage_spaces": number or null,
 "rooms": [{"RoomType": one of ${JSON.stringify(ROOM_TYPES)}, "RoomLevel": "1" for the ground floor, "2" for upstairs, "B" for a basement, "RoomLength": feet as a number, "RoomWidth": feet as a number}]}
Read dimensions like 13'4" x 12'0" as 13.3 and 12. The larger number is the length. Use "Bedroom-Primary" and "Bath-Primary" for the owner's suite.
List every bedroom, living, dining, kitchen, game, media, office and utility room that has dimensions on the plan. Skip closets, halls, porches and the garage.
Never invent rooms or sizes that aren't on the plan.`;

function parse(text: string): PlanScan | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const int = (v: unknown, max: number) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) && x >= 0 && x <= max ? x : null;
  };
  return {
    bedrooms_total: int(raw.bedrooms_total, 20),
    bathrooms_full: int(raw.bathrooms_full, 20),
    bathrooms_half: int(raw.bathrooms_half, 20),
    living_area: int(raw.living_area, 20000),
    stories: int(raw.stories, 5),
    garage_spaces: int(raw.garage_spaces, 10),
    rooms: cleanRooms(raw.rooms),
  };
}

// Returns what it read plus the tokens used (for AI credits and cost tracking).
export async function scanFloorPlan(url: string, mimeType: string): Promise<{ scan: PlanScan | null; usage: { input_tokens: number; output_tokens: number } }> {
  const client = new Anthropic();
  const file =
    mimeType === "application/pdf"
      ? ({ type: "document", source: { type: "url", url } } as const)
      : ({ type: "image", source: { type: "url", url } } as const);
  const reply = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: SYSTEM,
    messages: [{ role: "user", content: [file, { type: "text", text: "List the rooms on this floor plan." }] }],
  });
  return { scan: parse(reply.content.map((b) => (b.type === "text" ? b.text : "")).join("")), usage: reply.usage };
}

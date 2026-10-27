// NTREIS's room list: one row per room, with its level and size in feet.
// Stored as RESO "Rooms" rows (RoomType, RoomLevel, RoomLength, RoomWidth).

export type Room = { RoomType: string; RoomLevel?: string; RoomLength?: number | string; RoomWidth?: number | string; RoomFeatures?: string[] };

export const ROOM_TYPES = [
  "Living Room", "Family Room", "Great Room", "Game Room", "Media Room", "Den", "Office", "Library", "Loft", "Bonus Room",
  "Kitchen", "Breakfast Rm", "Dining Room",
  "Bedroom-Primary", "Bath-Primary", "Bedroom-2nd Primary", "Bedroom", "Guest Suite", "Bath-Full", "Bath-Half",
  "Utility Room", "Laundry", "Mud Room", "Extra Strg Rm", "Exercise Room", "Gym", "Music Room", "Wine Cellar", "Workshop",
  "Solarium/Sunrm", "Sauna", "Spa/HotTub Rm", "Basement",
];
export const ROOM_LEVELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "B"];

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(x) && x > 0 ? Math.round(x * 10) / 10 : undefined;
};

// Keep only rows the MLS would take.
export function cleanRooms(raw: unknown): Room[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Room)
    .filter((r) => r && ROOM_TYPES.includes(r.RoomType))
    .map((r) => ({
      RoomType: r.RoomType,
      RoomLevel: ROOM_LEVELS.includes(String(r.RoomLevel ?? "")) ? String(r.RoomLevel) : undefined,
      RoomLength: n(r.RoomLength),
      RoomWidth: n(r.RoomWidth),
    }))
    .slice(0, 60);
}

export const roomSize = (r: Room) => (r.RoomLength && r.RoomWidth ? `${Number(r.RoomLength)} × ${Number(r.RoomWidth)}` : "—");
export const levelLabel = (l?: string) => (l === "B" ? "Basement" : l ? `Level ${l}` : "—");

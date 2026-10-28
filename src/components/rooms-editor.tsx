"use client";

import { useEffect, useRef, useState } from "react";
import { ROOM_LEVELS, ROOM_TYPES, type Room } from "@/lib/rooms";

// Edit a room list (type, level, length × width in feet). Submits it as JSON in
// one hidden field. With formId, "start from a floor plan" can fill it too.
export function RoomsEditor({ name = "rooms_json", initial, formId, disabled }: { name?: string; initial: Room[]; formId?: string; disabled?: boolean }) {
  const [rooms, setRooms] = useState<Room[]>(initial);
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  // A person's own room edits are never replaced by "start from".
  const typedRef = useRef(false);

  useEffect(() => {
    if (!formId) return;
    const form = document.getElementById(formId);
    const onFill = (e: Event) => {
      const d = (e as CustomEvent<{ rooms: Room[]; label: string }>).detail;
      if (!d?.rooms?.length) return;
      if (typedRef.current) return;
      setRooms(d.rooms);
      setFilledFrom(d.label);
    };
    form?.addEventListener("rooms-fill", onFill);
    return () => form?.removeEventListener("rooms-fill", onFill);
  }, [formId]);

  const set = (i: number, patch: Partial<Room>) => {
    setFilledFrom(null);
    typedRef.current = true;
    setRooms((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  return (
    <div>
      <input type="hidden" name={name} value={JSON.stringify(rooms)} />
      {filledFrom && <p className="mb-2 text-xs text-emerald-800">Filled from {filledFrom}. Check the sizes for this lot.</p>}
      {rooms.length === 0 && <p className="text-sm text-muted">No rooms yet.</p>}
      {rooms.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="pb-1 pr-2 font-medium">Room</th><th className="pb-1 pr-2 font-medium">Level</th><th className="pb-1 pr-2 font-medium">Length (ft)</th><th className="pb-1 pr-2 font-medium">Width (ft)</th><th /></tr>
            </thead>
            <tbody>
              {rooms.map((r, i) => (
                <tr key={i}>
                  <td className="py-1 pr-2">
                    <select value={r.RoomType} disabled={disabled} onChange={(e) => set(i, { RoomType: e.target.value })} className="field-input py-1.5 text-sm" aria-label="Room">
                      {ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <select value={r.RoomLevel ?? ""} disabled={disabled} onChange={(e) => set(i, { RoomLevel: e.target.value || undefined })} className="field-input w-20 py-1.5 text-sm" aria-label="Level">
                      <option value="">—</option>
                      {ROOM_LEVELS.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-2"><input type="number" min="1" max="200" step="0.5" value={r.RoomLength ?? ""} disabled={disabled} onChange={(e) => set(i, { RoomLength: e.target.value })} className="field-input w-24 py-1.5 text-sm" aria-label="Length in feet" /></td>
                  <td className="py-1 pr-2"><input type="number" min="1" max="200" step="0.5" value={r.RoomWidth ?? ""} disabled={disabled} onChange={(e) => set(i, { RoomWidth: e.target.value })} className="field-input w-24 py-1.5 text-sm" aria-label="Width in feet" /></td>
                  <td className="py-1">{!disabled && <button type="button" onClick={() => setRooms((rs) => rs.filter((_, j) => j !== i))} className="text-xs text-red-700 underline">Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!disabled && (
        <button type="button" onClick={() => setRooms((rs) => [...rs, { RoomType: "Bedroom", RoomLevel: "1" }])} className="mt-2 rounded-xl border border-dashed border-line px-4 py-2 text-sm font-semibold hover:border-foreground">
          + Add a room
        </button>
      )}
      <p className="mt-1 text-xs text-muted">NTREIS needs the level, length and width on every room listed.</p>
    </div>
  );
}

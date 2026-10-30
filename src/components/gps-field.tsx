"use client";

import { useState } from "react";
import { looksLikeTexas, mapsLink, parseGps } from "@/lib/gps";

// "GPS coordinates" box for a home: paste from Google Maps or use this phone's
// location while standing on the lot. Sends one text box named `gps`; the
// server reads it with parseGps.
export function GpsField({ initial = "", disabled = false }: { initial?: string; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parseGps(value);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setNote("This browser can’t share its location. Paste the coordinates instead.");
      return;
    }
    setBusy(true);
    setNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        setValue(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`);
        setNote(`Filled in from this device (accurate to about ${Math.round(pos.coords.accuracy)} m). Save to keep it.`);
      },
      () => {
        setBusy(false);
        setNote("Location wasn’t shared. Allow location for this site, or paste the coordinates instead.");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 block text-sm font-medium">GPS coordinates <span className="font-normal text-muted">(optional)</span></span>
      <div className="flex flex-wrap gap-2">
        <input
          name="gps"
          value={value}
          onChange={(e) => { setValue(e.target.value); setNote(null); }}
          disabled={disabled}
          placeholder="32.776700, -96.797000"
          autoComplete="off"
          className="field-input min-w-0 flex-1"
        />
        {!disabled && (
          <button type="button" onClick={useMyLocation} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold hover:bg-soft disabled:opacity-60">
            {busy ? "Finding you…" : "Use my location"}
          </button>
        )}
      </div>
      <span className="mt-1 block text-xs text-muted">
        Latitude, longitude. In Google Maps, right-click the lot and click the numbers to copy them, or paste a Google Maps link.
      </span>
      {parsed === "bad" && <span className="mt-1 block text-xs font-medium text-red-700">We can’t read that. Use two numbers like 32.776700, -96.797000.</span>}
      {parsed && parsed !== "bad" && (
        <span className="mt-1 block text-xs">
          {!looksLikeTexas(parsed) && <b className="text-amber-800">That spot isn’t in Texas. Check for a missing minus sign. </b>}
          <a href={mapsLink(parsed)} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">Check it on the map</a>
        </span>
      )}
      {note && <span className="mt-1 block text-xs text-muted">{note}</span>}
    </div>
  );
}

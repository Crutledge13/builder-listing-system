"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { recordUploads, type UploadedFile } from "./actions";
import { TagPicker } from "@/components/tag-picker";
import type { ListTag } from "@/lib/tags";

type Community = { id: string; name: string; builder_id: string; builderName: string };
type Home = { id: string; community_id: string; unparsed_address: string };

const ROOMS: [string, string][] = [
  ["", "Let AI pick the room for each photo"],
  ["exterior", "Exterior"], ["kitchen", "Kitchen"], ["living", "Living room"], ["dining", "Dining"],
  ["primary_bedroom", "Primary bedroom"], ["bedroom", "Bedroom"], ["primary_bath", "Primary bath"], ["bath", "Bath"],
  ["backyard", "Backyard"], ["floor_plan", "Floor plan"], ["entrance", "Entrance"], ["amenity", "Amenity"],
  ["aerial", "Aerial or drone"], ["site_map", "Site plan"], ["model_home", "Model home"], ["other", "Other"],
];

const MAX_MB = 50;

export function UploadForm({
  communities,
  homes,
  presetCommunity,
  presetHome,
  showBuilder,
  communityWide,
  doneHref,
  tagList = [],
}: {
  tagList?: ListTag[];
  communities: Community[];
  homes: Home[];
  presetCommunity: string | null;
  presetHome: string | null;
  showBuilder: boolean;
  communityWide?: string[]; // communities where whole-community uploads are allowed (default: all)
  doneHref?: string;
}) {
  const router = useRouter();
  const [communityId, setCommunityId] = useState(presetCommunity ?? communities[0]?.id ?? "");
  const [homeId, setHomeId] = useState(presetHome ?? "");
  const wholeCommunityOk = !communityWide || communityWide.includes(communityId);
  const [room, setRoom] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, "waiting" | "uploading" | "done" | "failed">>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const homesHere = useMemo(() => homes.filter((h) => h.community_id === communityId), [homes, communityId]);
  const community = communities.find((c) => c.id === communityId);
  const tooBig = files.filter((f) => f.size > MAX_MB * 1_048_576);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!community || files.length === 0 || tooBig.length) return;
    if (!homeId && !wholeCommunityOk) {
      setMessage({ kind: "error", text: "Choose the home these files are for." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const supabase = createBrowserSupabase();
    const folder = `${community.builder_id}/${community.id}/${homeId || "community"}`;
    const done: UploadedFile[] = [];

    for (const f of files) {
      setProgress((p) => ({ ...p, [f.name]: "uploading" }));
      const ext = (f.name.split(".").pop() ?? "bin").toLowerCase();
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) {
        setProgress((p) => ({ ...p, [f.name]: "failed" }));
        continue;
      }
      done.push({ path, name: f.name, size: f.size, type: f.type });
      setProgress((p) => ({ ...p, [f.name]: "done" }));
    }

    if (done.length === 0) {
      setBusy(false);
      setMessage({ kind: "error", text: "None of the files uploaded. Check that your role can add media for this builder." });
      return;
    }

    const result = await recordUploads({
      communityId: community.id,
      homeId: homeId || null,
      room: room || null,
      tags,
      files: done,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    router.push(doneHref ? `${doneHref}?saved=${encodeURIComponent(`Uploaded ${result.count} ${result.count === 1 ? "file" : "files"}. Tap any of them to add tags.`)}` : homeId ? `/media?home=${homeId}` : `/media?community=${community.id}`);
  }

  return (
    <form onSubmit={upload} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Community</span>
          <select value={communityId} onChange={(e) => { setCommunityId(e.target.value); setHomeId(""); }} required className="field-input">
            {communities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{showBuilder ? ` (${c.builderName})` : ""}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Home</span>
          <select value={homeId} onChange={(e) => setHomeId(e.target.value)} className="field-input">
            {wholeCommunityOk ? <option value="">The whole community (amenities, aerials, site plan)</option> : <option value="" disabled>Choose the home</option>}
            {homesHere.map((h) => <option key={h.id} value={h.id}>{h.unparsed_address}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Room or type</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)} className="field-input">
            {ROOMS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="block">
          <span className="mb-1.5 block text-sm font-medium">Extra tags (optional)</span>
          <TagPicker list={tagList} name="upload_tag" onChange={setTags} />
          <span className="mt-1 block text-xs text-muted">From our shared list. Need a new one? Ask from any photo’s page after uploading.</span>
        </div>
      </div>

      <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-line p-8 text-center hover:border-foreground">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            setFiles(list);
            setProgress(Object.fromEntries(list.map((f) => [f.name, "waiting" as const])));
          }}
        />
        <span className="block font-semibold">Choose photos or videos</span>
        <span className="mt-1 block text-sm text-muted">JPG, PNG, HEIC, MP4 or MOV, up to {MAX_MB} MB each</span>
      </label>

      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate">{f.name}</span>
              <span className={f.size > MAX_MB * 1_048_576 || progress[f.name] === "failed" ? "text-red-700" : "text-muted"}>
                {f.size > MAX_MB * 1_048_576 ? "Too large" : { waiting: `${(f.size / 1_048_576).toFixed(1)} MB`, uploading: "Uploading…", done: "Uploaded", failed: "Failed" }[progress[f.name] ?? "waiting"]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className={message.kind === "error" ? "rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" : "rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"}>{message.text}</p>
      )}

      <button
        disabled={busy || files.length === 0 || tooBig.length > 0}
        className="rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {busy ? "Uploading…" : files.length ? `Upload ${files.length} ${files.length === 1 ? "file" : "files"}` : "Upload"}
      </button>
    </form>
  );
}

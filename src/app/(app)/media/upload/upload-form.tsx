"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { makePreviews } from "@/lib/previews";
import { uploadErrorText } from "@/lib/upload-errors";
import { recordUploads, type UploadedFile } from "./actions";
import { TagPicker } from "@/components/tag-picker";
import type { ListTag } from "@/lib/tags";
import { useFileDrop } from "@/lib/use-file-drop";
import { cx } from "@/lib/format";

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

// Videos don't have a room; pick what kind of video it is instead.
const VIDEO_TYPES: { key: string; label: string; room: string | null; tag: string | null }[] = [
  { key: "walkthrough", label: "Walkthrough video (horizontal)", room: null, tag: "Video tour" },
  { key: "reel", label: "Vertical social reel (9:16)", room: null, tag: "Vertical reel" },
  { key: "drone", label: "Drone or aerial", room: "aerial", tag: "Drone / aerial" },
  { key: "community", label: "Community or amenities", room: "amenity", tag: "Amenities" },
  { key: "other", label: "Something else", room: null, tag: null },
];

// One box can take everything, or just photos (and floor plan PDFs), or just video.
const MODES = {
  all: { accept: "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,application/pdf", title: "Choose photos or videos", types: "JPG, PNG, HEIC, MP4 or MOV" },
  photos: { accept: "image/jpeg,image/png,image/webp,image/heic,application/pdf", title: "Choose photos", types: "JPG, PNG, WebP, HEIC, or a floor plan PDF" },
  videos: { accept: "video/mp4,video/quicktime", title: "Choose videos", types: "MP4 or MOV" },
} as const;

export function UploadForm({
  communities,
  homes,
  presetCommunity,
  presetHome,
  showBuilder,
  communityWide,
  doneHref,
  tagList = [],
  mode = "all",
  cancelHref,
  videoPreset,
  aiOn = true,
}: {
  // Whether AI labeling is switched on (ANTHROPIC_API_KEY set). When it's off
  // we don't promise that AI will pick the rooms.
  aiOn?: boolean;
  // Fixes the kind of video (e.g. "reel" for a home's social media reel upload) and hides the picker.
  videoPreset?: string;
  mode?: keyof typeof MODES;
  cancelHref?: string;
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
  const [videoType, setVideoType] = useState(videoPreset ?? "walkthrough");
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, "waiting" | "uploading" | "done" | "failed">>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const homesHere = useMemo(() => homes.filter((h) => h.community_id === communityId), [homes, communityId]);
  const community = communities.find((c) => c.id === communityId);
  const tooBig = files.filter((f) => f.size > MAX_MB * 1_048_576);

  // Files picked with the button or dragged onto the box.
  function choose(picked: File[]) {
    const ok = MODES[mode].accept.split(",");
    // A taller-than-wide video is a social reel: pick that type for them.
    const firstVideo = picked.find((f) => f.type.startsWith("video/"));
    if (mode === "videos" && firstVideo && !videoPreset) {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        if (v.videoHeight > v.videoWidth) setVideoType("reel");
        URL.revokeObjectURL(v.src);
      };
      v.src = URL.createObjectURL(firstVideo);
    }
    const list = picked.filter((f) => !f.type || ok.includes(f.type) || (mode !== "videos" && /\.heic$/i.test(f.name)));
    if (list.length < picked.length) {
      setMessage({ kind: "error", text: `Skipped ${picked.length - list.length} ${picked.length - list.length === 1 ? "file" : "files"} this box doesn't take. Use ${MODES[mode].types}.` });
    } else {
      setMessage(null);
    }
    setFiles(list);
    setProgress(Object.fromEntries(list.map((f) => [f.name, "waiting" as const])));
  }
  const { dragging, dropProps } = useFileDrop(choose, busy);

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
    const failed: { name: string; why: string }[] = [];

    for (const f of files) {
      setProgress((p) => ({ ...p, [f.name]: "uploading" }));
      const ext = (f.name.split(".").pop() ?? "bin").toLowerCase();
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) {
        console.warn("Upload failed", f.name, error);
        failed.push({ name: f.name, why: uploadErrorText(error) });
        setProgress((p) => ({ ...p, [f.name]: "failed" }));
        continue;
      }
      // Small copies for grids and the photo's page. Best effort: if one fails,
      // the app simply shows the original for that file.
      const extra: { thumbPath?: string; webPath?: string } = {};
      for (const p of await makePreviews(f)) {
        const previewPath = path.replace(/\.[^./]+$/, "") + `.${p.suffix}.webp`;
        const { error: pErr } = await supabase.storage.from("media").upload(previewPath, p.blob, { contentType: "image/webp", upsert: false });
        if (!pErr) extra[p.suffix === "thumb" ? "thumbPath" : "webPath"] = previewPath;
      }
      done.push({ path, name: f.name, size: f.size, type: f.type, ...extra });
      setProgress((p) => ({ ...p, [f.name]: "done" }));
    }

    const failedText = () => {
      const reasons = [...new Set(failed.map((x) => x.why))];
      return `${failed.length} ${failed.length === 1 ? "file" : "files"} didn't upload (${failed.map((x) => x.name).join(", ")}): ${reasons.join("; ")}.`;
    };

    if (done.length === 0) {
      setBusy(false);
      setMessage({ kind: "error", text: `None of the files uploaded. ${failedText()}` });
      return;
    }

    const result = await recordUploads({
      communityId: community.id,
      homeId: homeId || null,
      ...(mode === "videos"
        ? (() => {
            const t = VIDEO_TYPES.find((v) => v.key === videoType) ?? VIDEO_TYPES[0];
            return { room: t.room, tags: t.tag ? [...tags, t.tag] : tags };
          })()
        : { room: room || null, tags }),
      files: done,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    // Some went through, some didn't: stay here so the person sees which ones.
    if (failed.length) {
      setFiles(files.filter((f) => failed.some((x) => x.name === f.name)));
      setMessage({ kind: "error", text: `Uploaded ${result.count}. ${failedText()} The ones listed are still here to try again.` });
      return;
    }
    router.push(doneHref ? doneUrl(doneHref, `Uploaded ${result.count} ${result.count === 1 ? "file" : "files"}.${videoPreset === "reel" ? " It's on this home's realtor share link, not the MLS." : " Tap any of them to add tags."}`) : homeId ? `/media?home=${homeId}` : `/media?community=${community.id}`);
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
        {mode === "videos" && videoPreset ? (
          <div className="block">
            <span className="mb-1.5 block text-sm font-medium">What kind of video?</span>
            <p className="field-input bg-soft">{VIDEO_TYPES.find((v) => v.key === videoPreset)?.label ?? "Video"}</p>
          </div>
        ) : mode === "videos" ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">What kind of video?</span>
            <select value={videoType} onChange={(e) => setVideoType(e.target.value)} className="field-input">
              {VIDEO_TYPES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Room or type</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)} className="field-input">
              {ROOMS.map(([k, v]) => <option key={k} value={k}>{k === "" && !aiOn ? "Pick later, on each photo" : v}</option>)}
            </select>
          </label>
        )}
        <div className="block">
          <span className="mb-1.5 block text-sm font-medium">Extra tags (optional)</span>
          <TagPicker list={tagList} name="upload_tag" onChange={setTags} />
          <span className="mt-1 block text-xs text-muted">From our shared list. Need a new one? Ask from any photo’s page after uploading.</span>
        </div>
      </div>

      <label {...dropProps} className={cx("block cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center hover:border-foreground", dragging ? "border-accent bg-accent-soft/40" : "border-line")}>
        <input
          type="file"
          multiple
          accept={MODES[mode].accept}
          className="sr-only"
          onChange={(e) => {
            choose(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <span className="block font-semibold">{dragging ? "Drop the files here" : `${MODES[mode].title}, or drag them here`}</span>
        <span className="mt-1 block text-sm text-muted">{MODES[mode].types}, up to {MAX_MB} MB each</span>
      </label>

      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate">{f.name}</span>
              <span className={f.size > MAX_MB * 1_048_576 || progress[f.name] === "failed" ? "text-red-700" : "text-muted"}>
                {f.size > MAX_MB * 1_048_576 ? `Too large (over ${MAX_MB} MB)` : { waiting: `${(f.size / 1_048_576).toFixed(1)} MB`, uploading: "Uploading…", done: "Uploaded", failed: "Failed" }[progress[f.name] ?? "waiting"]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tooBig.length > 0 && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {tooBig.length === 1 ? "1 file is" : `${tooBig.length} files are`} over {MAX_MB} MB, the most our storage account takes per file. Pick the files again without {tooBig.length === 1 ? "it" : "them"}, or make a smaller copy (for video, export at 1080p).
        </p>
      )}

      {message && (
        <p className={message.kind === "error" ? "rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" : "rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"}>{message.text}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={busy || files.length === 0 || tooBig.length > 0}
          className="rounded-xl bg-accent px-6 py-3 font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {busy ? "Uploading…" : files.length ? `Upload ${files.length} ${files.length === 1 ? (mode === "videos" ? "video" : mode === "photos" ? "photo" : "file") : mode === "videos" ? "videos" : mode === "photos" ? "photos" : "files"}` : "Upload"}
        </button>
        {cancelHref && !busy && (
          <Link href={cancelHref} className="rounded-xl px-4 py-3 font-semibold text-muted hover:bg-soft hover:text-foreground">
            {files.length ? "Cancel" : "Not now, go back"}
          </Link>
        )}
      </div>
    </form>
  );
}

// Where to go after uploading, with the "Uploaded N files" message. The done
// address may already have a query (?at=...) and a #section to scroll to.
function doneUrl(href: string, message: string) {
  const [path, hash] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}saved=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

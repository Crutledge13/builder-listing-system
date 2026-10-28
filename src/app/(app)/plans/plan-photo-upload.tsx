"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { makePreviews } from "@/lib/previews";
import { uploadErrorText } from "@/lib/upload-errors";
import type { UploadedFile } from "@/app/(app)/media/upload/actions";
import { recordPlanPhotos } from "./photo-actions";

const MAX_MB = 50;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime";

// Add model home photos (or a video) to a floor plan. Files go straight from
// the browser to private storage, like every other upload.
export function PlanPhotoUpload({ planId, builderId }: { planId: string; builderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function upload(list: File[]) {
    const tooBig = list.filter((f) => f.size > MAX_MB * 1_048_576);
    const files = list.filter((f) => f.size <= MAX_MB * 1_048_576);
    if (!files.length) {
      setMessage({ kind: "error", text: `Files must be under ${MAX_MB} MB each.` });
      return;
    }
    setMessage(null);
    const supabase = createBrowserSupabase();
    const done: UploadedFile[] = [];
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      const ext = (f.name.split(".").pop() ?? "bin").toLowerCase();
      const path = `${builderId}/plans/${planId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("media").upload(path, f, { contentType: f.type || undefined, upsert: false });
      if (error) {
        failed.push(`${f.name} (${uploadErrorText(error)})`);
        continue;
      }
      const extra: { thumbPath?: string; webPath?: string } = {};
      for (const p of await makePreviews(f)) {
        const previewPath = path.replace(/\.[^./]+$/, "") + `.${p.suffix}.webp`;
        const { error: pErr } = await supabase.storage.from("media").upload(previewPath, p.blob, { contentType: "image/webp", upsert: false });
        if (!pErr) extra[p.suffix === "thumb" ? "thumbPath" : "webPath"] = previewPath;
      }
      done.push({ path, name: f.name, size: f.size, type: f.type, ...extra });
    }
    let text = "";
    if (done.length) {
      setBusy("Saving…");
      const r = await recordPlanPhotos(planId, done);
      if (!r.ok) {
        setBusy(null);
        setMessage({ kind: "error", text: r.error });
        return;
      }
      text = `Added ${r.count} ${r.count === 1 ? "file" : "files"}.`;
    }
    const skipped = [...failed, ...tooBig.map((f) => `${f.name} (over ${MAX_MB} MB)`)];
    setBusy(null);
    setMessage(skipped.length ? { kind: "error", text: `${text} Didn’t upload: ${skipped.join(", ")}.`.trim() } : { kind: "ok", text });
    router.refresh();
  }

  return (
    <div>
      <label className={`block cursor-pointer rounded-2xl border-2 border-dashed border-line p-6 text-center hover:border-foreground ${busy ? "pointer-events-none opacity-70" : ""}`}>
        <input
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          disabled={!!busy}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (list.length) void upload(list);
          }}
        />
        {busy ? (
          <span className="inline-flex items-center gap-2 font-semibold">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            {busy}
          </span>
        ) : (
          <>
            <span className="block font-semibold">Add photos of this plan</span>
            <span className="mt-1 block text-sm text-muted">Model home photos or a walkthrough video. JPG, PNG, HEIC, MP4 or MOV, up to {MAX_MB} MB each.</span>
          </>
        )}
      </label>
      {message && (
        <p className={`mt-3 rounded-xl px-4 py-2.5 text-sm ${message.kind === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p>
      )}
    </div>
  );
}

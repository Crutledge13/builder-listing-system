"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { uploadErrorText } from "@/lib/upload-errors";
import { useFileDrop } from "@/lib/use-file-drop";

// Uploads one image straight from the browser to a private storage bucket,
// then tells the server where it went. Storage's own rules check the folder.
export function ImageUpload({
  bucket,
  folder,
  accept = "image/jpeg,image/png,image/webp",
  label,
  save,
  remove,
  hasImage,
  maxMb = 5,
  typesLabel = "a JPG, PNG or WebP image",
  busyLabel = "Uploading…",
  square = false,
}: {
  square?: boolean; // pad the image onto a square (nothing is cut off), e.g. logos
  maxMb?: number;
  typesLabel?: string;
  busyLabel?: string;
  bucket: string;
  folder: string;
  accept?: string;
  label: string;
  save: (path: string, fileName: string) => Promise<{ error?: string }>;
  remove?: () => Promise<{ error?: string }>;
  hasImage: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(picked: File | undefined) {
    let file = picked;
    if (!file) return;
    setError(null);
    if (file.size > maxMb * 1_048_576) return setError(`That file is over ${maxMb} MB. Try a smaller one.`);
    if (!accept.split(",").includes(file.type)) return setError(`Use ${typesLabel}.`);
    setBusy(true);
    if (square) file = await toSquare(file);
    const ext = file.type === "image/svg+xml" ? "svg" : file.type === "application/pdf" ? "pdf" : (file.name.split(".").pop() ?? "jpg").toLowerCase();
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: upError } = await createBrowserSupabase().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (upError) {
      setBusy(false);
      return setError(`The upload didn’t go through: ${uploadErrorText(upError)}.`);
    }
    const result = await save(path, file.name);
    setBusy(false);
    if (result.error) return setError(result.error);
    if (input.current) input.current.value = "";
    router.refresh();
  }

  // Dropping a file on the button works too (only the first file is used).
  const { dragging, dropProps } = useFileDrop((files) => void pick(files[0]), busy);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <label {...dropProps} title="Click to choose a file, or drag one here" className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-soft ${dragging ? "border-accent bg-accent-soft/40" : "border-foreground"} ${busy ? "pointer-events-none opacity-70" : ""}`}>
          {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
          {busy ? busyLabel : dragging ? "Drop it here" : hasImage ? `Change ${label}` : `Add ${label}`}
          <input ref={input} type="file" accept={accept} className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {hasImage && remove && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await remove();
              setBusy(false);
              if (r.error) setError(r.error);
              else router.refresh();
            }}
            className="rounded-xl px-3 py-2 text-sm font-semibold text-red-700 underline hover:bg-red-50"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

// Centers the picture on a square, see-through canvas (up to 1024 px a side),
// so a wide or tall logo fits a square space without being cut or stretched.
// SVGs and anything the browser can't read are left as they are.
async function toSquare(file: File): Promise<File> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file;
  try {
    const img = await createImageBitmap(file);
    const longest = Math.max(img.width, img.height);
    const side = Math.min(1024, longest);
    const scale = side / longest;
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, Math.round((side - w) / 2), Math.round((side - h) / 2), w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
  } catch {
    return file;
  }
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { uploadErrorText } from "@/lib/upload-errors";

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
}: {
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

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > maxMb * 1_048_576) return setError(`That file is over ${maxMb} MB. Try a smaller one.`);
    if (!accept.split(",").includes(file.type)) return setError(`Use ${typesLabel}.`);
    setBusy(true);
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

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-xl border border-foreground px-4 py-2 text-sm font-semibold hover:bg-soft">
          {busy ? busyLabel : hasImage ? `Change ${label}` : `Add ${label}`}
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

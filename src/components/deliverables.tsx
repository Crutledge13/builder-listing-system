import { ImageUpload } from "@/components/image-upload";
import { DELIVERABLE_TYPES, fileSize, type DeliverableFile, type DeliverableTable } from "@/lib/deliverables";
import { saveDeliverable, trashDeliverable } from "@/app/(app)/deliverable-actions";

// The files delivered for one request, with download links. Our team also gets
// an "Attach a file" button (the file goes straight from the browser to private storage).
export function Deliverables({
  files,
  table,
  requestId,
  builderId,
  staff,
  back,
}: {
  files: DeliverableFile[];
  table: DeliverableTable;
  requestId: string;
  builderId: string;
  staff: boolean;
  back: string;
}) {
  if (!files.length && !staff) return null;
  return (
    <div className="mt-3 space-y-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
              <svg viewBox="0 0 16 16" className="h-4 w-4 text-accent" aria-hidden><path d="M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7.5A.5.5 0 0 1 3.5 14V2a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M9 1.5V5h3" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              <a href={`/api/deliverables/${f.id}`} className="font-semibold text-accent underline">{f.file_name}</a>
              <span className="text-xs text-muted">{fileSize(f.size_bytes)}</span>
              {staff && (
                <form action={trashDeliverable}>
                  <input type="hidden" name="file_id" value={f.id} />
                  <input type="hidden" name="back" value={back} />
                  <button className="text-xs text-red-700 underline" aria-label={`Remove ${f.file_name}`}>Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {staff && (
        <ImageUpload
          bucket="deliverables"
          folder={`${builderId}/${table}/${requestId}`}
          accept={DELIVERABLE_TYPES}
          typesLabel="a PDF, Excel, CSV, Word, zip or image file"
          maxMb={50}
          label="a file (PDF, Excel, CSV…)"
          hasImage={false}
          save={saveDeliverable.bind(null, table, requestId, back)}
        />
      )}
    </div>
  );
}

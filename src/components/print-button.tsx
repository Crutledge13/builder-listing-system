"use client";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-full border border-foreground px-4 py-2.5 text-sm font-semibold hover:bg-soft print:hidden">
      {label}
    </button>
  );
}

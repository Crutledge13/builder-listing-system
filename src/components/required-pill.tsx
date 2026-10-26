// Marks a required question, in our accent color instead of the MLS's red star.
// "save": needed to save the draft. "mls": the MLS needs it before going live.
export function RequiredPill({ kind = "mls" }: { kind?: "save" | "mls" }) {
  return kind === "save" ? (
    <span className="ml-1.5 inline-block rounded-full bg-accent px-2 py-px align-middle text-[11px] font-semibold text-white">Required</span>
  ) : (
    <span className="ml-1.5 inline-block rounded-full bg-accent-soft px-2 py-px align-middle text-[11px] font-semibold text-accent">
      MLS required<span className="sr-only"> (the MLS needs this before the listing goes live)</span>
    </span>
  );
}

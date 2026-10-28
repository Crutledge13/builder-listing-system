// The arrow on a fold-out row (<details className="group">): points down, flips up when open.
export function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden>
      <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

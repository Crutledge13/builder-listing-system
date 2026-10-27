export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path d="M8 16.5 16 9l8 7.5V24a1 1 0 0 1-1 1h-4.5v-5h-5v5H9a1 1 0 0 1-1-1z" fill="#fff" />
      </svg>
      <span className={`whitespace-nowrap text-[17px] font-bold tracking-tight text-foreground ${compact ? "hidden md:inline" : ""}`}>Builder Listing Services</span>
    </span>
  );
}

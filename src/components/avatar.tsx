import { cx } from "@/lib/format";

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// A person's headshot, or their initials when they haven't added one.
// `version` is when the photo last changed, so a new photo shows right away.
export function Avatar({ id, name, version, className = "h-8 w-8 text-xs" }: { id: string; name: string; version?: string | null; className?: string }) {
  if (version) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/avatar/${id}?v=${encodeURIComponent(version)}`} alt={name} className={cx("shrink-0 rounded-full object-cover", className)} />
    );
  }
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-full bg-foreground font-semibold text-white", className)} aria-label={name}>
      {initials(name)}
    </span>
  );
}

// A builder's logo, or a neutral badge with their initials.
export function BuilderLogo({
  builderId,
  name,
  version,
  className = "h-8 max-w-[120px]",
  icon = false,
}: {
  builderId: string;
  name: string;
  version?: string | null;
  className?: string;
  // The builder's square icon instead of the main logo (falls back to the logo).
  icon?: boolean;
}) {
  const clean = name.replace(" (demo)", "");
  if (version) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/logo/${builderId}?${icon ? "kind=icon&" : ""}v=${encodeURIComponent(version)}`} alt={`${clean} logo`} className={cx("w-auto shrink-0 object-contain", className)} />
    );
  }
  return (
    <span className={cx("inline-flex aspect-square shrink-0 items-center justify-center rounded-lg border border-line bg-soft text-[11px] font-bold text-muted", className)} aria-label={clean}>
      {initials(clean)}
    </span>
  );
}

// Only ever send people to a page on this site. Accepts "/homes/123?x=1#y" and
// rejects anything a browser could read as another website: "//evil.com",
// "/\evil.com" (browsers treat a backslash like a slash), "https://...", or
// hidden control characters.
export function safePath(to: string | null | undefined, fallback: string): string {
  const s = String(to ?? "");
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(s)) return fallback;
  try {
    // Resolve against a placeholder site: a safe path never changes the host.
    const u = new URL(s, "https://this.site");
    if (u.host !== "this.site") return fallback;
  } catch {
    return fallback;
  }
  return s;
}

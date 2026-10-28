// Drawn logos for demo builders, so the test system shows real-looking logos
// without stored files. A logo path of the form
//   <builder id>/demo-logo/<6-digit hex color>/<Name-With-Dashes>.svg
// (set only by supabase/seed/demo_more_builders.sql) is drawn here instead of
// being fetched from storage. Real uploads never use that folder.

const DEMO_LOGO = /^[0-9a-f-]{36}\/demo-logo\/([0-9a-fA-F]{6})\/([A-Za-z0-9-]{1,60})\.svg$/;

export function demoLogoResponse(path: string | null | undefined): Response | null {
  const m = path ? DEMO_LOGO.exec(path) : null;
  if (!m) return null;
  const color = `#${m[1]}`;
  const words = m[2].split("-").filter(Boolean);
  const name = words.join(" ");
  const initials = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const width = Math.max(200, 88 + name.length * 15);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 72" width="${width}" height="72" role="img" aria-label="${name}">
  <rect x="4" y="8" width="56" height="56" rx="14" fill="${color}"/>
  <path d="M14 46 L32 24 L50 46 Z" fill="#ffffff" opacity="0.28"/>
  <text x="32" y="44" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="700" fill="#ffffff">${initials}</text>
  <text x="74" y="45" font-family="Georgia, serif" font-size="25" font-weight="700" fill="${color}">${name}</text>
</svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=3000" } });
}

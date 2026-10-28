// The home's own page on the builder's website, as pasted by someone at the
// builder (homes.website_page_url). Builders with their website connected get
// this from the feed instead; this is for builders who haven't connected it.

// Clean up what was pasted. Returns null for blank, "bad" for something that
// isn't a web address. Adds https:// when it was left off.
export function cleanWebsitePage(raw: FormDataEntryValue | null): string | null | "bad" {
  let v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (v.length > 500 || /\s/.test(v)) return "bad";
  try {
    const u = new URL(v);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return "bad";
    return u.toString();
  } catch {
    return "bad";
  }
}

export const WEBSITE_PAGE_HELP =
  "Optional. The link to this home on your website, so realtors you share it with can click through for more information. Leave blank to send them to your main website.";

// What the realtor share page shows (public.share_page_settings, one row per
// builder; no row = everything on). The database follows these too: a
// switched-off item isn't on the page and its files can't be downloaded.

export const SHARE_SWITCHES = [
  { key: "show_community", group: "The community", label: "Community section", help: "The community’s own photos, video and tour links in their own section, so a realtor can market the whole community and point buyers to this home." },
  { key: "show_photos", group: "This home", label: "Listing photos", help: "The home’s photos, with a size picker and Download all." },
  { key: "show_walkthrough", group: "This home", label: "Walkthrough video", help: "Horizontal walkthrough videos, with Download." },
  { key: "show_reels", group: "This home", label: "Social media reel", help: "Vertical reels sized for Instagram, TikTok and Facebook, with Download." },
  { key: "show_tours", group: "This home", label: "3D and video tours", help: "Matterport, Zillow 3D Home and other tour links." },
  { key: "show_incentives", group: "Selling points", label: "Incentives", help: "Current builder, community and home incentives." },
  { key: "show_open_houses", group: "Selling points", label: "Upcoming open houses", help: "The next few open house dates and times." },
  { key: "show_post_ideas", group: "Selling points", label: "Social post ideas", help: "Ready-to-copy posts written from the home’s details." },
  { key: "show_website", group: "Selling points", label: "Link to your website", help: "The “More info on your website” button." },
] as const;

export type ShareSwitch = (typeof SHARE_SWITCHES)[number]["key"];
export type ShareSettings = Record<ShareSwitch, boolean>;

export const SHARE_DEFAULTS: ShareSettings = Object.fromEntries(SHARE_SWITCHES.map((s) => [s.key, true])) as ShareSettings;
export const SHARE_SELECT = SHARE_SWITCHES.map((s) => s.key).join(", ") + ", updated_at";

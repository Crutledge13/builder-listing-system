// Supabase address and publishable key. These two values are designed to be
// public (they ship to every browser); the database's row-level security rules
// are what protect the data.
//
// The fallbacks point at the TEST project so the demo deploys with no setup.
// When the live project exists, set NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel's production environment.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fautaulhpsmeqnlzyhdc.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_fzqghcELBTWrbuXP3LVaLA_9avhYESN";

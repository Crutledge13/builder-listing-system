"use client";

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

// Used only for uploads, so files go straight from the browser to private
// storage instead of passing through our server. Storage's own rules check
// that the person may upload into that builder's folder.
export function createBrowserSupabase() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
}

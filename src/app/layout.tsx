import type { Metadata } from "next";
import { Suspense } from "react";
import { ClickFeedback } from "@/components/click-feedback";
import { GeistMono } from "geist/font/mono";
import "@fontsource-variable/figtree";
import "./globals.css";
import { SUPABASE_URL } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Builder Listing Services",
  description: "Private listing back office for builders and staff.",
  // Private system: keep it out of search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistMono.variable} h-full antialiased`}>
      <head>
        {/* Photos come from storage at this address: open the connection while the page loads. */}
        <link rel="preconnect" href={SUPABASE_URL} />
        <link rel="dns-prefetch" href={SUPABASE_URL} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <Suspense>
          <ClickFeedback />
        </Suspense>
      </body>
    </html>
  );
}

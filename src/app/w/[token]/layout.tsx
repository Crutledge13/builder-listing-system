import type { Metadata } from "next";

// One-off broker link (owners, 30 Oct 2026): one work order for a broker who
// has no account, until it's accepted or the builder turns the link off.
// A plain bar and nothing else; never indexed, the link never passed on.
export const metadata: Metadata = {
  title: "MLS work order · Builder Listing Services",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line bg-white print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:px-8">
          <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
            <rect width="32" height="32" rx="9" fill="var(--accent)" />
            <path d="M8 16.5 16 9l8 7.5V24a1 1 0 0 1-1 1h-4.5v-5h-5v5H9a1 1 0 0 1-1-1z" fill="#fff" />
          </svg>
          <span className="text-[17px] font-bold tracking-tight">MLS work order</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6 sm:px-8">{children}</main>
    </>
  );
}

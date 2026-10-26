import Link from "next/link";

// A clear way back, sized for a thumb on a phone.
export function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-foreground">
      <span aria-hidden>←</span> {label}
    </Link>
  );
}

"use client";

import { Suspense, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { backStep, onTrailChange } from "@/lib/nav-trail";

// A clear way back, sized for a thumb on a phone. Goes to the page the person
// came from in this tab (and the section they were in), named by its heading;
// `href` and `label` are only used when there's no earlier page (opened from a
// bookmark, an email or a new tab).
// `onlyWithTrail`: show nothing unless there's an earlier page (for top-level
// pages like the media library, which have no natural parent).
type Props = { href: string; label: string; variant?: "button" | "text"; onlyWithTrail?: boolean };

export function BackButton(props: Props) {
  // Which page we're on is only known at request time, so the trail-aware part
  // streams in; until then it's the plain fallback link.
  return (
    <Suspense fallback={props.onlyWithTrail ? null : <BackLink to={props.href} text={props.label} variant={props.variant} />}>
      <TrailBack {...props} />
    </Suspense>
  );
}

function TrailBack({ href, label, variant = "button", onlyWithTrail }: Props) {
  // The earlier page lives in this tab's storage, which only the browser has:
  // the server (and the first paint) use href and label, then this takes over.
  const current = usePathname();
  const saved = useSyncExternalStore(onTrailChange, () => trailTarget(current), () => "");
  const target = saved ? (JSON.parse(saved) as { href: string; label: string }) : null;

  if (!target && onlyWithTrail) return null;
  return <BackLink to={target?.href ?? href} text={target?.label ?? label} variant={variant} />;
}

function BackLink({ to, text, variant = "button" }: { to: string; text: string; variant?: Props["variant"] }) {
  return variant === "text" ? (
    <Link href={to} className="text-sm font-medium text-muted hover:text-foreground">
      <span aria-hidden>←</span> {text}
    </Link>
  ) : (
    <Link href={to} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-foreground">
      <span aria-hidden>←</span> <span className="truncate">{text}</span>
    </Link>
  );
}

// A string, so React sees the same value each time it asks.
function trailTarget(current: string) {
  const step = backStep(current);
  return step ? JSON.stringify({ href: step.url + (step.hash ?? ""), label: step.name ? `Back to ${step.name}` : "Back" }) : "";
}

"use client";

import { useFormStatus } from "react-dom";
import { cx } from "@/lib/format";

// A form's submit button that says what it's doing the moment it's clicked
// and can't be clicked again until the save finishes, so a slow save can't
// make duplicates. Use inside a <form action={...}>.
export function PendingButton({
  children,
  pending: pendingText,
  className,
  confirm,
}: {
  children: React.ReactNode;
  pending: string; // e.g. "Making link…"
  className?: string;
  confirm?: string; // ask first ("Turn off this link?")
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cx(className, "inline-flex items-center gap-2 disabled:opacity-70")}
    >
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {pending ? pendingText : children}
    </button>
  );
}

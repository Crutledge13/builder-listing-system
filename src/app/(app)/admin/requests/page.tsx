import { Suspense } from "react";
import { Notice } from "@/components/notice";
import { RequestsInbox } from "@/components/requests-inbox";

export default function RequestsAdmin(props: PageProps<"/admin/requests">) {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <p className="mb-4 text-muted">Every open change request across all builders, oldest first. Fix the home, then mark the request done.</p>
      <RequestsInbox back="/admin/requests" showBuilder canResolve />
    </Suspense>
  );
}

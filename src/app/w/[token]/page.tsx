import { Suspense } from "react";
import { linkFileBase, loadLinkTask } from "@/lib/broker";
import { Notice } from "@/components/notice";
import { BrokerWorkOrder } from "@/components/broker-work-order";
import { linkNote, linkSendBack, linkSubmit, linkToggle } from "./actions";

// A one-off broker link. The database checks the link is live and its work
// order still open (public.broker_link_sheet); every button checks again.
export default function LinkPage(props: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Work params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Work({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const work = await loadLinkTask(token);
  if (!work) {
    const sent = typeof sp.saved === "string";
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-2xl font-bold">{sent ? "All done" : "This link isn’t working any more"}</h1>
        <p className="mt-2 text-muted">{sent ? "The builder has it now. Thank you." : "The work order was finished, or the builder turned this link off. Ask them for a new one if you still need it."}</p>
      </div>
    );
  }
  return (
    <div>
      {work.linkName && <p className="mb-4 rounded-xl bg-soft px-4 py-3 text-sm">Sent to <b>{work.linkName}</b> by {work.builderName}. This link works for this one work order until the builder accepts it.</p>}
      <BrokerWorkOrder
        work={work}
        by={{ name: "token", value: token }}
        fileBase={linkFileBase(token)}
        actions={{ toggle: linkToggle, submit: linkSubmit, note: linkNote, sendBack: linkSendBack }}
      />
    </div>
  );
}

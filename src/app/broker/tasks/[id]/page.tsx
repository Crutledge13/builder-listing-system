import { Suspense } from "react";
import { notFound } from "next/navigation";
import { brokerFileBase, loadBrokerTask, requireBrokerWithTerms } from "@/lib/broker";
import { Notice } from "@/components/notice";
import { BrokerWorkOrder } from "@/components/broker-work-order";
import { brokerAddNote, brokerSendBack, brokerSetStatus, brokerSubmit, brokerToggleCheck } from "../../actions";

// One work order for a signed-in outside broker: the copy-ready sheet, a way
// to send it back with corrections, and "send to the builder" when it's done.
export default function BrokerTaskPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Notice searchParams={props.searchParams} />
      <Work params={props.params} />
    </Suspense>
  );
}

async function Work({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireBrokerWithTerms();
  const work = await loadBrokerTask(id);
  if (!work) notFound();
  return (
    <BrokerWorkOrder
      work={work}
      by={{ name: "id", value: work.task.id }}
      fileBase={brokerFileBase(work.task.id)}
      backHref="/broker"
      actions={{ toggle: brokerToggleCheck, submit: brokerSubmit, note: brokerAddNote, sendBack: brokerSendBack, setStatus: brokerSetStatus }}
    />
  );
}

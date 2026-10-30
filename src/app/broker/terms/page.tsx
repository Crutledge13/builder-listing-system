import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireBroker } from "@/lib/broker";
import { acceptBrokerTerms } from "../actions";

// Shown once, on a broker's first sign-in.
export default function BrokerTerms() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-soft" />}>
      <Terms />
    </Suspense>
  );
}

async function Terms() {
  const { info } = await requireBroker();
  if (info.terms_at) redirect("/broker");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[28px] font-bold tracking-tight">Before you start</h1>
      <p className="mt-2 text-muted">
        {info.builders.length ? `${info.builders.join(", ")} sends you its listings here to enter in the MLS.` : "Builders send you their listings here to enter in the MLS."} Please read and accept these terms.
      </p>
      <ol className="mt-6 list-decimal space-y-3 rounded-2xl border border-line p-6 pl-10 text-[15px] leading-relaxed">
        <li>You use this site only to enter and update the listings builders send you on the MLS.</li>
        <li>Your sign-in is for you alone. Don’t share it or let anyone else use it.</li>
        <li>Don’t copy, record, rebuild or reverse-engineer this software, its screens or how it works, or help anyone else do so.</li>
        <li>Listing details, photos and videos are the builder’s. Use them only for that builder’s MLS listings.</li>
        <li>Access ends when the builder removes you, and can be turned off at any time.</li>
      </ol>
      <form action={acceptBrokerTerms} className="mt-6">
        <button className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white hover:brightness-110">I accept these terms</button>
      </form>
    </div>
  );
}

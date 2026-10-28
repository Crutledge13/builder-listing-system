import { Suspense } from "react";
import { BackButton } from "@/components/back-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/components/print-button";
import { InvoiceDocument } from "@/components/invoice-document";
import { loadInvoice } from "@/lib/invoice-data";

// A builder owner's copy of one sent invoice (the database only returns sent
// and paid invoices for their own company).
export default function OwnerInvoice(props: PageProps<"/billing/invoices/[id]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Page params={props.params} />
    </Suspense>
  );
}

async function Page({ params }: { params: PageProps<"/billing/invoices/[id]">["params"] }) {
  const me = await requireProfile();
  if (me.role !== "builder_owner") notFound();
  const { id } = await params;
  const data = await loadInvoice(await createClient(), id);
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <BackButton variant="text" href="/billing" label="Billing" />
        <PrintButton />
      </div>
      <div className="mt-4">
        <InvoiceDocument invoice={data.invoice} charges={data.charges} billTo={data.billTo} from={data.from} />
      </div>
    </div>
  );
}

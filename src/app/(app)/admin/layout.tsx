import { Suspense } from "react";
import { requireProfile } from "@/lib/auth";
import { AdminTabs } from "./tabs";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<div className="mt-16 h-64 animate-pulse rounded-2xl bg-soft" />}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}

async function Gate({ children }: { children: React.ReactNode }) {
  const me = await requireProfile();
  if (me.role !== "platform_admin") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-[28px] font-bold tracking-tight">Admin is for our platform admins</h1>
        <p className="mt-3 text-muted">Ask an admin on our team if you need a builder, community or person changed.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Admin</h1>
      <p className="mt-1 text-muted">Builders, communities, people and requests across the whole system.</p>
      <AdminTabs />
      <div className="mt-8">{children}</div>
    </div>
  );
}

import { Suspense } from "react";
import Link from "next/link";
import { demoModeOn, requireProfile } from "@/lib/auth";
import { ROLE_LABELS, canEditBranding, isStaff } from "@/lib/permissions";
import { Notice } from "@/components/notice";
import { Avatar } from "@/components/avatar";
import { ImageUpload } from "@/components/image-upload";
import { changeEmail, changePassword, removeAvatar, saveAvatar, saveProfile } from "./actions";

export default function AccountPage(props: PageProps<"/account">) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">My profile</h1>
      <p className="mt-1 text-muted">How you show up to your team and ours, and how you sign in.</p>
      <Suspense fallback={<div className="mt-8 h-96 animate-pulse rounded-2xl bg-soft" />}>
        <div className="mt-6"><Notice searchParams={props.searchParams} /></div>
        <Account />
      </Suspense>
    </div>
  );
}

async function Account() {
  const me = await requireProfile();
  const demoLogin = demoModeOn() && me.email.endsWith("@demo.test");
  const company = me.role === "photographer" ? "Contractor" : isStaff(me.role) ? "Our team" : me.builder_name?.replace(" (demo)", "");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Headshot</h2>
        <div className="mt-4 flex items-center gap-5">
          <Avatar id={me.id} name={me.full_name} version={me.avatar_updated_at} className="h-20 w-20 text-xl" />
          <div>
            <ImageUpload bucket="profile-photos" folder={me.id} label="a photo" hasImage={!!me.avatar_updated_at} save={saveAvatar} remove={removeAvatar} />
            <p className="mt-2 text-xs text-muted">A clear, friendly photo of your face. JPG, PNG or WebP, up to 5 MB. Only people in the system can see it.</p>
          </div>
        </div>
      </section>

      <form action={saveProfile} className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Your details</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="mb-1 block text-sm font-medium">Name</span><input name="full_name" defaultValue={me.full_name} required maxLength={80} className="field-input" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">Job title</span><input name="job_title" defaultValue={me.job_title ?? ""} maxLength={80} placeholder="e.g. Sales counselor" className="field-input" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">Phone</span><input name="phone" type="tel" defaultValue={me.phone ?? ""} maxLength={30} placeholder="(214) 555-0100" className="field-input" /></label>
        </div>
        <p className="mt-3 text-sm text-muted">
          Role: <b className="text-foreground">{ROLE_LABELS[me.role]}</b>, {company}.{" "}
          {isStaff(me.role) || me.role === "photographer" ? "Ask an admin to change your role." : "Your company’s owner or a manager changes roles."}
        </p>
        <button className="mt-4 rounded-xl bg-foreground px-5 py-2.5 font-semibold text-white hover:bg-black">Save</button>
      </form>

      <form id="email" action={changeEmail} className="scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Sign-in email</h2>
        <p className="mt-1 text-sm text-muted">You sign in with <b className="text-foreground">{me.email}</b>. We’ll send a link to the new address; the change happens when you click it.</p>
        <label className="mt-4 block"><span className="mb-1 block text-sm font-medium">New email</span><input name="email" type="email" required disabled={demoLogin} className="field-input" /></label>
        <button disabled={demoLogin} className="mt-4 rounded-xl border border-foreground px-5 py-2.5 font-semibold hover:bg-soft disabled:opacity-40">Send confirmation link</button>
        {demoLogin && <p className="mt-2 text-xs text-muted">Turned off for shared demo logins.</p>}
      </form>

      <form id="password" action={changePassword} className="scroll-mt-28 rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Password</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-sm font-medium">Current password</span><input name="current" type="password" autoComplete="current-password" required disabled={demoLogin} className="field-input" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">New password</span><input name="password" type="password" autoComplete="new-password" minLength={10} required disabled={demoLogin} className="field-input" /></label>
          <label className="block"><span className="mb-1 block text-sm font-medium">New password again</span><input name="confirm" type="password" autoComplete="new-password" minLength={10} required disabled={demoLogin} className="field-input" /></label>
        </div>
        <p className="mt-2 text-xs text-muted">At least 10 characters. A short phrase is easier to remember and harder to guess.</p>
        <button disabled={demoLogin} className="mt-4 rounded-xl border border-foreground px-5 py-2.5 font-semibold hover:bg-soft disabled:opacity-40">Change password</button>
        {demoLogin && <p className="mt-2 text-xs text-muted">Turned off for shared demo logins.</p>}
      </form>

      {canEditBranding(me.role) && me.builder_id && (
        <Link href="/branding" className="block rounded-2xl border border-line p-5 hover:bg-soft">
          <span className="font-semibold">{me.builder_name?.replace(" (demo)", "")} branding →</span>
          <span className="mt-1 block text-sm text-muted">Logo, colors and website for your company.</span>
        </Link>
      )}
    </div>
  );
}

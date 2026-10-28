import { Suspense } from "react";
import { signIn } from "./actions";
import { HomeArt } from "@/components/home-art";
import { Logo } from "@/components/logo";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="grid flex-1 lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="w-full max-w-sm py-12">
            <h1 className="text-[32px] font-bold leading-tight tracking-tight">Welcome back</h1>
            <p className="mt-2 text-muted">Sign in to manage your homes, photos and listings.</p>

            <Suspense>
              <LoginError searchParams={props.searchParams} />
            </Suspense>

            <form action={signIn} className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Email</span>
                <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" className="field-input" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">Password</span>
                <input name="password" type="password" required autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="field-input" />
              </label>
              <button className="w-full rounded-xl bg-accent px-4 py-3.5 font-semibold text-white hover:brightness-110">
                Sign in
              </button>
            </form>
            <p className="mt-6 text-sm text-muted">Logins are set up by your account owner. There’s no public sign-up.</p>
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <HomeArt seed="welcome-home" stories={2} scene="twilight" className="absolute inset-0 h-full w-full" />
      </div>
    </main>
  );
}

async function LoginError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  return (
    <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
      {error === "no-profile"
        ? "Your login works, but no account is set up for it yet. Ask your account owner to add you."
        : error === "inactive"
          ? "Your access has been turned off. Ask your account owner if that’s a mistake."
          : error === "invite-expired"
            ? "That invite link has expired or was already used. Ask whoever invited you for a new one; they can make it in a few seconds."
          : "That email and password don’t match. Check the password’s capital letters and try again."}
    </p>
  );
}

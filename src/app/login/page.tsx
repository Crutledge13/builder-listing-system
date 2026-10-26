import { Suspense } from "react";
import { signIn } from "./actions";

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-accent">Private back office</p>
        <h1 className="mt-1 text-2xl font-semibold">Builder Listings</h1>
        <p className="mt-2 text-sm text-muted">Sign in with the login your team gave you.</p>

        <Suspense>
          <LoginError searchParams={props.searchParams} />
        </Suspense>

        <form action={signIn} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" className="field-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input name="password" type="password" required autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="field-input" />
          </label>
          <button className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}

async function LoginError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  if (!error) return null;
  return (
    <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {error === "no-profile"
        ? "Your login works, but no account is set up for it yet. Ask your admin."
        : "That email and password didn’t match."}
    </p>
  );
}

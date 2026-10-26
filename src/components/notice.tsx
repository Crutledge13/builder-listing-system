// Shows the ?error= or ?saved= message after a form submits.
export async function Notice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const saved = typeof sp.saved === "string" ? sp.saved : null;
  if (error) return <p className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>;
  if (saved) return <p className="mb-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{saved}</p>;
  return null;
}

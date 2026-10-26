import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-xl font-semibold">Home not found</h1>
      <p className="mt-2 text-sm text-muted">It doesn’t exist, or your account doesn’t have access to it.</p>
      <Link href="/homes" className="mt-4 inline-block text-sm text-accent hover:underline">Back to homes</Link>
    </div>
  );
}

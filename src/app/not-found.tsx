import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-[400px] p-6 text-center">
        <div className="font-semibold">Page not found</div>
        <p className="mt-2 text-[13px] text-ink-3">There is no page at this address.</p>
        <Link href="/" className="btn-primary mt-5 inline-flex">Go to Squad CRM</Link>
      </div>
    </div>
  );
}

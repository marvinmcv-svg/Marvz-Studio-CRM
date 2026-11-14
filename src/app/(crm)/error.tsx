"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

/** Shown inside the app shell when a page fails to load (e.g. a query error), instead of a blank crash. */
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="p-4 md:p-6">
      <div className="card mx-auto max-w-[520px] p-6">
        <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} className="text-amber-300" /> This page couldn&apos;t load</div>
        <p className="mt-2 text-[13px] text-ink-2">
          Something went wrong while loading the data. Nothing was changed. Try again; if it keeps happening, check that
          Supabase is reachable and the migrations are applied.
        </p>
        {error.digest && <p className="mt-2 text-[12px] text-ink-3">Reference: <code>{error.digest}</code></p>}
        <div className="mt-5 flex gap-2">
          <button className="btn-primary" onClick={reset}><RotateCw size={14} /> Try again</button>
          <Link href="/" className="btn">Go to overview</Link>
        </div>
      </div>
    </div>
  );
}

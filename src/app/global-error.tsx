"use client";

import "./globals.css";

/** Last-resort error screen when the root layout itself fails. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="card w-full max-w-[420px] p-6">
            <div className="font-semibold">Squad CRM couldn&apos;t start</div>
            <p className="mt-2 text-[13px] text-ink-2">{error.message || "Unexpected error."}</p>
            {error.digest && <p className="mt-2 text-[12px] text-ink-3">Reference: <code>{error.digest}</code></p>}
            <button className="btn-primary mt-5" onClick={reset}>Try again</button>
          </div>
        </div>
      </body>
    </html>
  );
}

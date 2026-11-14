"use client";

import { useState, useTransition } from "react";
import { updateEscalation } from "@/app/actions";

export function EscalationActions({ id, status, me }: { id: string; status: string; me: string }) {
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (a: "review" | "escalate_to_letty" | "resolve" | "dismiss") => start(async () => {
    const r = await updateEscalation(id, a, notes);
    setErr(r.ok ? null : r.error);
    if (r.ok) setNotes("");
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input className="input min-w-[200px] flex-1" placeholder="Notes / resolution…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {status === "open" && <button className="btn" disabled={pending} onClick={() => act("review")}>Take it</button>}
      {status !== "with_letty" && me === "top_g" && <button className="btn" disabled={pending} onClick={() => act("escalate_to_letty")}>Send to Letty</button>}
      <button className="btn-primary" disabled={pending || !notes.trim()} onClick={() => act("resolve")}>Resolve</button>
      <button className="btn-ghost" disabled={pending} onClick={() => act("dismiss")}>Dismiss</button>
      {err && <div className="w-full rounded-lg bg-rose-400/10 px-3 py-2 text-[12px] text-rose-300">{err}</div>}
    </div>
  );
}

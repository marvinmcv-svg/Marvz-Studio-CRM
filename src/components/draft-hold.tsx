"use client";

import { Pause, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setDraftHold } from "@/app/actions";

/** Hold / release a draft before it goes into an approval batch (held drafts can't be batched). */
export function DraftHoldButton({ draftId, onHold }: { draftId: string; onHold: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (hold: boolean) => start(async () => {
    const r = await setDraftHold(draftId, hold, reason);
    if (!r.ok) { setError(r.error); return; }
    setAsking(false); setReason(""); setError(null); router.refresh();
  });
  if (onHold) return <button className="btn h-8" disabled={pending} onClick={() => submit(false)}><Play size={13} /> Release draft</button>;
  return (
    <div>
      {!asking ? <button className="btn h-8" onClick={() => setAsking(true)}><Pause size={13} /> Hold draft</button> : (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input h-8 max-w-[320px] flex-1" autoFocus placeholder="Why hold it?" aria-label="Hold reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn-primary h-8" disabled={pending || !reason.trim()} onClick={() => submit(true)}>Hold</button>
          <button className="btn-ghost h-8" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-rose-300">{error}</p>}
    </div>
  );
}

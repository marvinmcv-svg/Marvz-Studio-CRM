"use client";

import clsx from "clsx";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { recordApproval } from "@/app/actions";
import { Chip } from "./ui";

type D = { id: string; leadId: string; business: string; code: string; channel: string; language: string; subject: string | null; body: string; personalisation: string | null };

export function BatchReview({ batchId, drafts, canDecide }: { batchId: string; drafts: D[]; canDecide: boolean }) {
  const [decision, setDecision] = useState<Record<string, "approve" | "reject">>(() => Object.fromEntries(drafts.map((d) => [d.id, "approve"])));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const approved = drafts.filter((d) => decision[d.id] === "approve").map((d) => d.id);
  const rejected = drafts.filter((d) => decision[d.id] === "reject").map((d) => d.id);

  return (
    <div>
      <ul className="divide-y divide-line/70">
        {drafts.map((d) => (
          <li key={d.id} className={clsx("px-4 py-3", decision[d.id] === "reject" && "opacity-55")}>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/leads/${d.leadId}`} className="font-medium hover:text-accent-2">{d.business}</Link>
              <span className="text-[12px] text-ink-3">{d.code}</span>
              <Chip>{d.channel}</Chip><Chip>{d.language.toUpperCase()}</Chip>
              {canDecide && (
                <div className="ml-auto flex rounded-lg border border-line-2 p-0.5">
                  <button onClick={() => setDecision((x) => ({ ...x, [d.id]: "approve" }))} aria-pressed={decision[d.id] === "approve"}
                    className={clsx("flex h-6 items-center gap-1 rounded-md px-2 text-[12px]", decision[d.id] === "approve" ? "bg-emerald-400/15 text-emerald-300" : "text-ink-3")}><Check size={12} /> Approve</button>
                  <button onClick={() => setDecision((x) => ({ ...x, [d.id]: "reject" }))} aria-pressed={decision[d.id] === "reject"}
                    className={clsx("flex h-6 items-center gap-1 rounded-md px-2 text-[12px]", decision[d.id] === "reject" ? "bg-rose-400/15 text-rose-300" : "text-ink-3")}><X size={12} /> Reject</button>
                </div>
              )}
            </div>
            {d.subject && <div className="mt-1.5 text-ink-2">{d.subject}</div>}
            <p className="mt-1 whitespace-pre-wrap text-ink">{d.body}</p>
            {d.personalisation && <p className="mt-1 text-[12px] text-ink-3">Why it fits: {d.personalisation}</p>}
          </li>
        ))}
      </ul>
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <input className="input min-w-[200px] flex-1" placeholder="Note for Jordan (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary" disabled={pending} onClick={() => start(async () => {
            const r = await recordApproval(batchId, approved, rejected, note);
            setMsg(r.ok ? { ok: true, text: "Decision recorded — Jordan can now send the approved drafts." } : { ok: false, text: r.error });
          })}>
            {pending ? "Saving…" : `Approve ${approved.length}${rejected.length ? ` · reject ${rejected.length}` : ""}`}
          </button>
          {msg && <div className={clsx("w-full rounded-lg px-3 py-2 text-[12px]", msg.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>{msg.text}</div>}
        </div>
      )}
    </div>
  );
}

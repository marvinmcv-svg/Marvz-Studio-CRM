"use client";

import { useState, useTransition } from "react";
import { advanceStage } from "@/app/actions";
import { ALL_STAGES, canMoveStage, stageMeta } from "@/lib/constants";
import type { Stage } from "@/lib/types";

/** Modal asking for the mandatory reason before a stage change. */
export function StageMoveDialog({ leadName, from, to, onClose, leadId, onDone }: {
  leadId: string; leadName: string; from: Stage; to: Stage; onClose: () => void; onDone?: (ok: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => start(async () => {
    const r = await advanceStage(leadId, to, reason.trim());
    if (!r.ok) { setError(r.error); onDone?.(false); return; }
    onDone?.(true);
    onClose();
  });
  return (
    <div data-modal-open className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-3" onClick={onClose}>
      <div className="card w-full max-w-[440px] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold">Move {leadName}</div>
        <div className="mt-1 text-[12px] text-ink-3">{stageMeta(from).label} → <span className="text-ink">{stageMeta(to).label}</span> · logged with your name, time and reason</div>
        <label className="label mt-4" htmlFor="reason">Reason (required)</label>
        <textarea id="reason" autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reason.trim()) submit(); }}
          className="input h-auto py-2" placeholder="e.g. Client signed the proposal on WhatsApp" />
        {error && <p className="mt-3 rounded-lg bg-rose-400/10 px-3 py-2 text-[12px] text-rose-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!reason.trim() || pending} onClick={submit}>{pending ? "Moving…" : "Move lead"} <span className="kbd ml-1 border-black/20 bg-black/10 text-accent-ink">⌘↵</span></button>
        </div>
      </div>
    </div>
  );
}

export function StageSelect({ leadId, leadName, stage, agent }: { leadId: string; leadName: string; stage: Stage; agent: string }) {
  const [to, setTo] = useState<Stage | null>(null);
  return (
    <>
      <select value={stage} onChange={(e) => setTo(e.target.value as Stage)} className="input w-auto" aria-label="Move to stage">
        {ALL_STAGES.map((s) => {
          const check = s.key === stage ? null : canMoveStage(agent, stage, s.key);
          const blocked = check && !check.ok;
          return (
            <option key={s.key} value={s.key} disabled={!!blocked}>
              {s.label}{blocked ? ` — ${check.reason}` : ""}
            </option>
          );
        })}
      </select>
      {to && to !== stage && <StageMoveDialog leadId={leadId} leadName={leadName} from={stage} to={to} onClose={() => setTo(null)} />}
    </>
  );
}

"use client";
import { useState, useTransition } from "react";
import { addDoNotContact } from "@/app/actions";

export function DncForm({ disabled }: { disabled: boolean }) {
  const [kind, setKind] = useState("business");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await addDoNotContact(kind, value, reason);
        setMsg(r.ok ? "Added — creating leads that match is now blocked." : r.error);
        if (r.ok) { setValue(""); setReason(""); }
      });
    }}>
      <div><label className="label" htmlFor="kind">Type</label>
        <select id="kind" className="input w-auto" value={kind} onChange={(e) => setKind(e.target.value)}>
          {["business", "email", "phone", "domain", "instagram"].map((k) => <option key={k}>{k}</option>)}
        </select></div>
      <div className="min-w-[180px] flex-1"><label className="label" htmlFor="value">Value</label><input id="value" required className="input" value={value} onChange={(e) => setValue(e.target.value)} /></div>
      <div className="min-w-[220px] flex-[2]"><label className="label" htmlFor="reason">Reason</label><input id="reason" required className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <button className="btn-primary" disabled={disabled || pending}>Add</button>
      {msg && <div className="w-full text-[12px] text-ink-2">{msg}</div>}
    </form>
  );
}

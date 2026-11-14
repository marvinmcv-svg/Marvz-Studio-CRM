"use client";

import clsx from "clsx";
import { Columns3, Rows3, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Opt = { value: string; label: string };

export function PipelineFilters({ options }: { options: Record<"stage" | "industry" | "service" | "market" | "agent", Opt[]> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const set = (key: string, value: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const id = setTimeout(() => { if ((params.get("q") ?? "") !== q) set("q", q || null); }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const view = params.get("view") ?? "board";
  const active = (["stage", "industry", "service", "market", "agent"] as const).filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
      <div className="relative w-full sm:w-[220px]">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, city…" className="input pl-8" />
      </div>
      {(Object.keys(options) as (keyof typeof options)[]).map((k) => (
        <select key={k} value={params.get(k) ?? ""} onChange={(e) => set(k, e.target.value || null)}
          className={clsx("input w-auto max-w-[160px] pr-7 capitalize", params.get(k) && "border-accent/60 text-accent-2")}>
          <option value="">{k === "agent" ? "Any owner" : `Any ${k}`}</option>
          {options[k].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      {active.length > 0 && (
        <button className="btn-ghost" onClick={() => {
          const p = new URLSearchParams(params.toString());
          active.forEach((k) => p.delete(k));
          router.replace(`${pathname}?${p.toString()}`);
        }}><X size={13} /> Clear</button>
      )}
      <div className="ml-auto flex rounded-lg border border-line-2 p-0.5">
        {[{ v: "board", icon: <Columns3 size={14} />, l: "Board" }, { v: "table", icon: <Rows3 size={14} />, l: "Table" }].map((o) => (
          <button key={o.v} onClick={() => set("view", o.v === "board" ? null : o.v)}
            className={clsx("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px]", view === o.v ? "bg-panel-3 text-ink" : "text-ink-3 hover:text-ink-2")}>
            {o.icon}{o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

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
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-1 md:px-8">
      <div className="relative w-full sm:w-[240px]">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, city…" aria-label="Filter leads" className="input pl-9" />
      </div>
      {/* on phones the filters scroll sideways in one row instead of stacking */}
      <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0">
        {(Object.keys(options) as (keyof typeof options)[]).map((k) => (
          <select key={k} value={params.get(k) ?? ""} onChange={(e) => set(k, e.target.value || null)}
            aria-label={k === "agent" ? "Owner" : k}
            className={clsx("input w-auto max-w-[170px] shrink-0 rounded-full pr-8 capitalize", params.get(k) && "border-accent text-accent")}>
            <option value="">{k === "agent" ? "Any owner" : `Any ${k}`}</option>
            {options[k].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {active.length > 0 && (
        <button className="btn-ghost" onClick={() => {
          const p = new URLSearchParams(params.toString());
          active.forEach((k) => p.delete(k));
          router.replace(`${pathname}?${p.toString()}`);
        }}><X size={13} /> Clear</button>
      )}
      <div className="segmented ml-auto" role="radiogroup" aria-label="View">
        {[{ v: "board", icon: <Columns3 size={14} />, l: "Board" }, { v: "table", icon: <Rows3 size={14} />, l: "Table" }].map((o) => (
          <button key={o.v} onClick={() => set("view", o.v === "board" ? null : o.v)} role="radio" aria-checked={view === o.v}
            data-active={view === o.v} className="segment">
            {o.icon}{o.l}
          </button>
        ))}
      </div>
    </div>
  );
}

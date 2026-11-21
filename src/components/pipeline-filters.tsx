"use client";

import clsx from "clsx";
import { Columns3, Rows3, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type Opt = { value: string; label: string };

export type FilterDef = { key: string; any: string; label: string; values: Opt[] };

export function PipelineFilters({ filters }: { filters: FilterDef[] }) {
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
  const active = filters.map((f) => f.key).filter((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-line px-4 py-2.5 md:px-8">
      <div className="relative w-full sm:w-[220px]">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, city…" aria-label="Filter leads" className="input h-7 pl-8 text-[12.5px]" />
      </div>
      {/* on phones the filters scroll sideways in one row instead of stacking */}
      <div className="-mx-4 flex w-[calc(100%+2rem)] gap-1.5 overflow-x-auto px-4 pb-0.5 sm:order-last sm:mx-0 sm:w-auto sm:basis-full sm:flex-wrap sm:overflow-visible sm:px-0">
        {filters.map((f) => (
          <select key={f.key} value={params.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value || null)}
            aria-label={f.label}
            className={clsx("input h-7 w-auto max-w-[170px] shrink-0 rounded-[7px] pr-7 text-[12.5px]",
              params.get(f.key) ? "border-accent/60 bg-accent/10 text-accent-2" : "border-dashed bg-transparent text-ink-2")}>
            <option value="">{f.any}</option>
            {f.values.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
      </div>
      {active.length > 0 && (
        <button className="btn-ghost h-7" onClick={() => {
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

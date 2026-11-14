"use client";

import clsx from "clsx";
import { Minus, Plus, Zap } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { createDeal } from "@/app/actions";
import { money } from "@/lib/format";
import { marketPrice, quote, type Catalogue, type PaymentPlan } from "@/lib/quote";

type LeadOpt = { id: string; label: string; market: string | null; interest: string[] };

export function DealBuilder({ cat, leads, initialLead, demo, rushPercent, capacity }: {
  cat: Catalogue; leads: LeadOpt[]; initialLead: string | null; demo: boolean; rushPercent: number;
  capacity: { used: number; limit: number };
}) {
  const startLead = leads.find((l) => l.id === initialLead);
  const [leadId, setLeadId] = useState(startLead?.id ?? "");
  const [market, setMarket] = useState(startLead?.market ?? "US");
  const [pkg, setPkg] = useState<string | null>(startLead?.interest.find((s) => cat.packages.some((p) => p.code === s)) ?? "full_house");
  const [addons, setAddons] = useState<Record<string, number>>(() =>
    Object.fromEntries((startLead?.interest ?? []).filter((s) => cat.addons.some((a) => a.code === s)).map((s) => [s, 1])));
  const [plan, setPlan] = useState<PaymentPlan>("50_50");
  const [rush, setRush] = useState(false);
  const [care, setCare] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string; dealId?: string } | null>(null);
  const [pending, start] = useTransition();

  const m = cat.markets.find((x) => x.code === market) ?? cat.markets[0];
  const q = useMemo(() => quote({
    packageCode: pkg, addons: Object.entries(addons).map(([code, qty]) => ({ code, qty })), market, paymentPlan: plan, rush, carePlan: care,
  }, cat, rushPercent), [pkg, addons, market, plan, rush, care, cat, rushPercent]);
  const fmt = (n: number) => money(n, q.currency);

  const pickLead = (id: string) => {
    setLeadId(id);
    const l = leads.find((x) => x.id === id);
    if (!l) return;
    if (l.market) setMarket(l.market);
    const p = l.interest.find((s) => cat.packages.some((x) => x.code === s));
    if (p) setPkg(p);
    setAddons(Object.fromEntries(l.interest.filter((s) => cat.addons.some((a) => a.code === s)).map((s) => [s, 1])));
  };

  const save = () => start(async () => {
    const r = await createDeal({
      leadId, packageCode: pkg, addons: Object.entries(addons).map(([code, qty]) => ({ code, qty })), market,
      paymentPlan: plan, rush, carePlan: care,
    });
    setResult(r.ok ? { ok: true, text: `Saved ${r.data.deal_ref} — quoted by the database from the catalogue.`, dealId: r.data.deal_id } : { ok: false, text: r.error });
  });

  return (
    <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[1fr_380px]">
      <div className="grid content-start gap-4">
        <section className="card p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="label" htmlFor="lead">Lead</label>
              <select id="lead" className="input" value={leadId} onChange={(e) => pickLead(e.target.value)}>
                <option value="">— Quote without a lead (preview only) —</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Market</label>
              <div className="flex flex-wrap rounded-lg border border-line-2 p-0.5">
                {cat.markets.map((x) => (
                  <button key={x.code} onClick={() => setMarket(x.code)}
                    className={clsx("h-7 rounded-md px-2.5 text-[12px]", x.code === market ? "bg-panel-3 text-ink" : "text-ink-3 hover:text-ink-2")}>{x.code}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <div className="card-t mb-3">Package</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[...cat.packages.sort((a, b) => a.sort - b.sort), null].map((p) => {
              const price = p ? (cat.prices.find((x) => x.package_code === p.code && x.market_code === market)?.price ?? marketPrice(p.price_usd, m)) : 0;
              const active = (p?.code ?? null) === pkg;
              return (
                <button key={p?.code ?? "none"} onClick={() => setPkg(p?.code ?? null)}
                  className={clsx("rounded-lg border p-3 text-left transition-colors", active ? "border-accent/70 bg-accent/10" : "border-line-2 hover:bg-panel-2")}>
                  <div className="font-medium">{p?.name ?? "Add-ons only"}</div>
                  <div className="mt-0.5 tabular-nums text-ink-2">{p ? fmt(Number(price)) : "—"}</div>
                  {p && <div className="mt-0.5 text-[11px] text-ink-3">{p.weeks_min}–{p.weeks_max} wks{p.included_care_months ? ` · ${p.included_care_months}mo care` : ""}</div>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="card p-4">
          <div className="card-t mb-3">Add-ons</div>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {cat.addons.sort((a, b) => a.sort - b.sort).map((a) => {
              const qty = addons[a.code] ?? 0;
              return (
                <div key={a.code} className={clsx("flex items-center gap-2 rounded-lg border px-2.5 py-2", qty ? "border-accent/50 bg-accent/[0.07]" : "border-line")}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setAddons((x) => { const n = { ...x }; if (n[a.code]) delete n[a.code]; else n[a.code] = 1; return n; })}>
                    <div className="truncate text-[13px]">{a.name}</div>
                    <div className="text-[11px] tabular-nums text-ink-3">
                      {a.price_usd ? fmt(marketPrice(a.price_usd, m)) : ""}{a.monthly_usd ? `${a.price_usd ? " + " : ""}${fmt(marketPrice(a.monthly_usd, m))}/mo` : ""}{a.per_unit && ` / ${a.unit_label}`}
                    </div>
                  </button>
                  {a.per_unit && qty > 0 && (
                    <div className="flex items-center gap-1">
                      <button className="btn-ghost h-6 px-1" onClick={() => setAddons((x) => ({ ...x, [a.code]: Math.max(1, qty - 1) }))} aria-label="Less"><Minus size={12} /></button>
                      <span className="w-4 text-center tabular-nums">{qty}</span>
                      <button className="btn-ghost h-6 px-1" onClick={() => setAddons((x) => ({ ...x, [a.code]: qty + 1 }))} aria-label="More"><Plus size={12} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card grid gap-4 p-4 sm:grid-cols-3">
          <div>
            <div className="label">Payment plan</div>
            <div className="flex rounded-lg border border-line-2 p-0.5">
              {(["50_50", "40_30_30"] as const).map((p) => (
                <button key={p} onClick={() => setPlan(p)} className={clsx("h-7 flex-1 rounded-md text-[12px]", plan === p ? "bg-panel-3 text-ink" : "text-ink-3")}>{p.replace(/_/g, "/")}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label">Delivery</div>
            <button onClick={() => setRush(!rush)} className={clsx("flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border text-[12px]", rush ? "border-amber-400/50 bg-amber-400/10 text-amber-300" : "border-line-2 text-ink-3")}>
              <Zap size={13} /> Rush (+{rushPercent}%) {rush ? "on" : "off"}
            </button>
          </div>
          <div>
            <div className="label">Care plan after launch</div>
            <select className="input" value={care ?? ""} onChange={(e) => setCare(e.target.value || null)}>
              <option value="">Included plan only</option>
              {cat.carePlans.map((c) => <option key={c.code} value={c.code}>{c.name} · {fmt(marketPrice(c.monthly_usd, m))}/mo</option>)}
            </select>
          </div>
        </section>
      </div>

      {/* Quote summary */}
      <aside className="card h-fit xl:sticky xl:top-4">
        <div className="card-h"><span className="card-t">Quote · {q.currency}</span>{q.weeks && <span className="text-[12px] text-ink-3">{q.weeks[0]}–{q.weeks[1]} weeks{rush && " (rushed)"}</span>}</div>
        <ul className="divide-y divide-line/60">
          {q.lines.map((l) => (
            <li key={l.kind + l.code} className="flex items-baseline gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate">{l.name}{l.qty > 1 && <span className="text-ink-3"> × {l.qty}</span>}</span>
              {l.monthly > 0 && <span className="text-[12px] tabular-nums text-ink-3">{fmt(l.monthly)}/mo</span>}
              <span className="w-[86px] text-right tabular-nums">{l.total ? fmt(l.total) : "—"}</span>
            </li>
          ))}
          {q.lines.length === 0 && <li className="px-4 py-6 text-center text-ink-3">Pick a package or add-ons</li>}
          {rush && <li className="flex px-4 py-2 text-amber-300"><span className="flex-1">Rush +{rushPercent}%</span><span className="tabular-nums">{fmt(q.rushFee)}</span></li>}
        </ul>
        <div className="border-t border-line px-4 py-3">
          <div className="flex items-baseline justify-between"><span className="text-ink-2">One-off total</span><span className="text-[22px] font-semibold tracking-tight tabular-nums">{fmt(q.total)}</span></div>
          {q.monthly > 0 && <div className="flex justify-between text-ink-2"><span>Recurring</span><span className="tabular-nums">{fmt(q.monthly)}/mo</span></div>}
          {q.currency !== "USD" && <div className="flex justify-between text-[12px] text-ink-3"><span>USD equivalent</span><span className="tabular-nums">{money(q.totalUsd)}</span></div>}
          {q.included.length > 0 && <div className="mt-2 text-[12px] text-emerald-300">Included: {q.included.join(" · ")}</div>}
        </div>
        <div className="border-t border-line px-4 py-3">
          <div className="card-t mb-2">Payment milestones</div>
          {q.schedule.map((s, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="flex size-5 items-center justify-center rounded-full bg-panel-3 text-[10px] tabular-nums">{i + 1}</span>
              <span className="flex-1">{s.label}</span>
              <span className="text-[12px] text-ink-3">{s.percent}%</span>
              <span className="w-[86px] text-right tabular-nums">{fmt(s.amount)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-4 py-3 text-[11px] text-ink-3">
          Prices exclude tax and processor fees. Capacity this month: {capacity.used}/{capacity.limit} slots{capacity.used >= capacity.limit && <span className="text-rose-300"> — full, schedule for next month</span>}.
        </div>
        <div className="border-t border-line p-3">
          <button className="btn-primary w-full justify-center" disabled={!leadId || pending || demo || q.lines.length === 0} onClick={save}>
            {demo ? "Connect Supabase to save deals" : !leadId ? "Pick a lead to save" : pending ? "Saving…" : "Save deal (create_deal)"}
          </button>
          {result && (
            <div className={clsx("mt-2 rounded-lg px-3 py-2 text-[12px]", result.ok ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>
              {result.text} {result.ok && <Link className="underline" href={`/leads/${leadId}?tab=deals`}>Open</Link>}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

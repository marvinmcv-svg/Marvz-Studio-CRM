"use client";

import clsx from "clsx";
import { AlertTriangle, Ban, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { checkDuplicates, createLead, type NewLeadInput } from "@/app/actions";
import { BUDGET_BANDS, CHANNELS } from "@/lib/constants";
import { DOMAIN_LABEL, PROBLEM_LABEL } from "@/lib/quality";

type Opt = { code: string; name: string };
type Dup = { lead_id: string; code: string; business: string; stage: string; matched_on: string[] };

/** Client-side mirror of the server duplicate check (used in demo mode). */
type Existing = { id: string; code: string; name: string; stage: string; email: string | null; phone: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const phoneTail = (s: string) => { const d = s.replace(/\D/g, ""); return d.length >= 7 ? d.slice(-8) : ""; };
/** Mirrors public.is_excluded_region(): Santa Cruz de la Sierra leads are never stored. */
const excludedRegion = (city?: string, country?: string) => {
  const c = norm(city ?? "");
  return c === "santacruzdelasierra" || (c === "santacruz" && ["", "bo", "bol", "bolivia"].includes((country ?? "").trim().toLowerCase()));
};

export function LeadForm({ markets, services, existing, demo }: { markets: Opt[]; services: Opt[]; existing: Existing[]; demo: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<NewLeadInput>({ business: "", market: "US", service_interest: [], budget_band: "unknown", languages: ["es"], channel: "whatsapp", domain_status: "UNVERIFIED" });
  const outOfRegion = excludedRegion(f.city, f.country);
  const [dups, setDups] = useState<Dup[]>([]);
  const [dnc, setDnc] = useState<{ kind: string; value: string; reason: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof NewLeadInput>(k: K, v: NewLeadInput[K]) => setF((x) => ({ ...x, [k]: v }));

  // Duplicate + do-not-contact check as you type (debounced)
  useEffect(() => {
    const id = setTimeout(async () => {
      if (!f.business && !f.email && !f.phone && !f.website && !f.instagram) { setDups([]); setDnc([]); return; }
      if (demo) {
        const b = norm(f.business), p = phoneTail(f.phone ?? ""), e = (f.email ?? "").trim().toLowerCase();
        setDups(existing.flatMap((x) => {
          const m: string[] = [];
          const xn = norm(x.name);
          if (b && xn === b) m.push("business name");
          else if (b.length >= 6 && (xn.includes(b) || b.includes(xn))) m.push("similar name");
          if (e && x.email?.toLowerCase() === e) m.push("email");
          if (p && x.phone && phoneTail(x.phone) === p) m.push("phone");
          return m.length ? [{ lead_id: x.id, code: x.code, business: x.name, stage: x.stage, matched_on: m }] : [];
        }));
        return;
      }
      const r = await checkDuplicates({ business: f.business, email: f.email, phone: f.phone, website: f.website, instagram: f.instagram, street: f.street, city: f.city });
      if (r.ok) { setDups(r.data.duplicates as Dup[]); setDnc(r.data.dnc as typeof dnc); }
    }, 350);
    return () => clearTimeout(id);
  }, [f.business, f.email, f.phone, f.website, f.instagram, f.street, f.city, demo, existing]);

  const submit = (force = false) => start(async () => {
    setError(null);
    const r = await createLead({ ...f, force });
    if (!r.ok) { setError(r.error); return; }
    if (r.data.status === "created") { setCreated({ id: r.data.lead_id!, code: r.data.code! }); router.refresh(); return; }
    if (r.data.status === "duplicate") setDups((r.data.matches ?? []) as Dup[]);
    if (r.data.status === "excluded_region") { setError("Santa Cruz de la Sierra leads are never stored in the CRM."); return; }
    setError(r.data.message ?? r.data.status);
  });

  const toggle = (k: "service_interest" | "languages", v: string) =>
    set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  if (created) {
    return (
      <div className="card mx-auto mt-8 max-w-md p-6 text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><Check /></div>
        <div className="font-semibold">{created.code} created</div>
        <p className="mt-1 text-ink-3">{f.hold ? "Stored as held: it can't be drafted until it's released." : "Logged in the activity feed. Jordan will screen it next."}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={`/leads/${created.id}`} className="btn-primary">Open lead</Link>
          <button className="btn" onClick={() => { setCreated(null); setF({ ...f, business: "", contact_name: "", email: "", phone: "", website: "", instagram: "" }); }}>Add another</button>
        </div>
      </div>
    );
  }

  const input = (k: keyof NewLeadInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <input id={k} className="input" value={(f[k] as string) ?? ""} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <form className="grid gap-4 p-4 md:p-8 xl:grid-cols-[1fr_340px]" onSubmit={(e) => { e.preventDefault(); submit(false); }}>
      <div className="grid gap-4">
        <section className="card p-4">
          <div className="card-t mb-3">Business & contact</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {input("business", "Business name *", { required: true, autoFocus: true, placeholder: "Café Altura" })}
            {input("contact_name", "Contact name")}
            {input("email", "Email", { type: "email" })}
            {input("phone", "Phone / WhatsApp", { placeholder: "+591 7…" })}
            {input("website", "Website", { placeholder: "example.com" })}
            {input("instagram", "Instagram", { placeholder: "@handle" })}
            {input("industry", "Industry", { placeholder: "Dental, Restaurant…" })}
            {input("street", "Street address", { placeholder: "Av. América 455" })}
            {input("city", "City")}
            {input("region", "Region / department")}
            {input("postcode", "Postcode")}
            {input("country", "Country", { placeholder: "BO" })}
            <div>
              <label className="label" htmlFor="market">Market (pricing)</label>
              <select id="market" className="input" value={f.market} onChange={(e) => set("market", e.target.value)}>
                {markets.map((m) => <option key={m.code} value={m.code}>{m.code} · {m.name}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <div className="card-t mb-3">Qualification</div>
          <label className="label">Service interest</label>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {services.map((s) => (
              <button type="button" key={s.code} onClick={() => toggle("service_interest", s.code)}
                className={clsx("h-7 rounded-md border px-2 text-[12px]", f.service_interest.includes(s.code) ? "border-accent/60 bg-accent/15 text-accent-2" : "border-line-2 text-ink-2 hover:bg-panel-2")}>
                {s.name}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="budget">Budget band</label>
              <select id="budget" className="input" value={f.budget_band} onChange={(e) => set("budget_band", e.target.value)}>
                {BUDGET_BANDS.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="channel">Channel</label>
              <select id="channel" className="input" value={f.channel} onChange={(e) => set("channel", e.target.value)}>
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {input("timeline", "Timeline", { placeholder: "Before high season" })}
            {input("source", "Source", { placeholder: "Google Maps" })}
            {input("portfolio_case", "Matching case study")}
            <div>
              <label className="label">Languages</label>
              <div className="flex gap-1.5">
                {["es", "en", "pt", "fr"].map((l) => (
                  <button type="button" key={l} onClick={() => toggle("languages", l)}
                    className={clsx("h-8 rounded-md border px-2.5 text-[12px] uppercase", f.languages.includes(l) ? "border-accent/60 bg-accent/15 text-accent-2" : "border-line-2 text-ink-2")}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <label className="label mt-3" htmlFor="notes">Notes</label>
          <textarea id="notes" rows={3} className="input h-auto py-2" value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </section>

        <section className="card p-4">
          <div className="card-t mb-3">Evidence & status</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="domain_status">Domain status</label>
              <select id="domain_status" className="input" value={f.domain_status} onChange={(e) => set("domain_status", e.target.value)}>
                {Object.entries(DOMAIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="website_problem_type">Website problem</label>
              <select id="website_problem_type" className="input" value={f.website_problem_type ?? ""} onChange={(e) => set("website_problem_type", e.target.value)}>
                <option value="">—</option>
                {Object.entries(PROBLEM_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {input("domain_proof_url", f.domain_status === "VERIFIED" ? "Domain proof URL *" : "Domain proof URL", { type: "url", placeholder: "https://…", required: f.domain_status === "VERIFIED" })}
            {input("source_key", "Source key", { placeholder: "P527-428" })}
          </div>
          <label className="mt-4 flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={!!f.hold} onChange={(e) => set("hold", e.target.checked)} />
            Store as <b>held</b> (unverified or parked — never drafted until released)
          </label>
          {f.hold && <div className="mt-2">{input("hold_reason", "Hold reason *", { required: true, placeholder: "Domain unconfirmed; listing says temporarily closed" })}</div>}
        </section>
      </div>

      <aside className="grid content-start gap-3 xl:sticky xl:top-4">
        <section className="card p-4">
          <div className="card-t mb-2">Duplicate & do-not-contact check</div>
          {dnc.length > 0 && (
            <div className="mb-2 rounded-lg bg-rose-400/10 p-3 text-[12px] text-rose-300">
              <div className="flex items-center gap-1.5 font-medium"><Ban size={13} /> On the do-not-contact list</div>
              {dnc.map((d, i) => <div key={i} className="mt-1">{d.kind}: {d.value} — {d.reason}</div>)}
            </div>
          )}
          {dups.length > 0 ? (
            <div className="rounded-lg bg-amber-400/10 p-3 text-[12px] text-amber-200">
              <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> Possible duplicate{dups.length > 1 && "s"}</div>
              {dups.map((d) => (
                <Link key={d.lead_id} href={`/leads/${d.lead_id}`} className="mt-1.5 block hover:underline">
                  {d.code} · {d.business} <span className="text-amber-200/70">({d.stage.replace(/_/g, " ")}) — matched on {d.matched_on.join(", ")}</span>
                </Link>
              ))}
            </div>
          ) : dnc.length === 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-ink-3"><Check size={13} className="text-emerald-300" /> No duplicates found so far</div>
          )}
        </section>
        {outOfRegion && <div className="rounded-xl bg-rose-400/10 px-3 py-2.5 text-[12.5px] text-rose-300">Santa Cruz de la Sierra leads are never stored in the CRM.</div>}
        {error && <div className="rounded-lg bg-rose-400/10 px-3 py-2 text-[12px] text-rose-300">{error}</div>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1 justify-center" disabled={pending || !f.business || dnc.length > 0 || outOfRegion}>{pending ? "Creating…" : f.hold ? "Create held lead" : "Create lead"}</button>
          {dups.length > 0 && <button type="button" className="btn" disabled={pending || dnc.length > 0 || outOfRegion} onClick={() => submit(true)}>Create anyway</button>}
        </div>
        <p className="text-[11px] text-ink-3">Calls <code className="text-ink-2">create_lead</code> — the same RPC Hunter uses — so it is checked and logged identically.</p>
      </aside>
    </form>
  );
}

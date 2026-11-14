import { FolderKanban } from "lucide-react";
import Link from "next/link";
import { Empty, Meter, PageHeader, StatusChip } from "@/components/ui";
import { getTables } from "@/lib/data";
import { monthLabel, shortDate } from "@/lib/format";
import { capacity, capacityLimit, isSlipping } from "@/lib/metrics";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const t = await getTables("projects", "milestones", "deliverables", "companies", "catalogue_terms");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const limit = capacityLimit(t.catalogue_terms);
  const months = [-1, 0, 1, 2].map((o) => {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + o);
    return capacity(t.projects, limit, d.toISOString().slice(0, 7));
  });
  const order = { at_risk: 0, active: 1, planning: 2, delivered: 3, closed: 4 } as const;
  const projects = [...t.projects].sort((a, b) => order[a.status] - order[b.status] || b.created_at.localeCompare(a.created_at));

  return (
    <div>
      <PageHeader title="Projects" icon={<FolderKanban size={18} className="text-ink-3" />}
        subtitle="Dana's handoff plans: milestones, deliverables, what the client owes, slip warnings" />
      <div className="grid gap-4 p-4 md:p-6">
        <section className="card">
          <div className="card-h"><span className="card-t">Capacity · {limit} new projects / month</span></div>
          <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
            {months.map((c, i) => (
              <div key={c.month}>
                <div className="flex items-baseline justify-between">
                  <span className={i === 1 ? "font-medium" : "text-ink-2"}>{monthLabel(c.month + "-01")}{i === 1 && " · now"}</span>
                  <span className="tabular-nums text-ink-2">{c.used}/{c.limit}</span>
                </div>
                <div className="mt-2 flex gap-1">
                  {Array.from({ length: c.limit }).map((_, k) => (
                    <span key={k} className={`h-2 flex-1 rounded-full ${k < c.used ? (c.remaining === 0 ? "bg-rose-400" : "bg-accent") : "bg-panel-3"}`} />
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-ink-3">{c.remaining ? `${c.remaining} slot${c.remaining > 1 ? "s" : ""} free` : "Full"}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="card overflow-x-auto">
          {projects.length === 0 ? <Empty title="No projects yet">Dana creates one after a deal is signed.</Empty> : (
            <table className="w-full min-w-[820px]">
              <thead><tr className="border-b border-line">{["Project", "Status", "Progress", "Next milestone", "Client owes", "Target", "Slot"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {projects.map((p) => {
                  const ms = t.milestones.filter((m) => m.project_id === p.id).sort((a, b) => a.sort - b.sort);
                  const done = ms.filter((m) => m.status === "done").length;
                  const next = ms.find((m) => m.status !== "done");
                  const slipping = ms.some(isSlipping);
                  const owes = t.deliverables.filter((d) => d.project_id === p.id && d.owner === "client" && d.status !== "done");
                  return (
                    <tr key={p.id} className="table-row">
                      <td className="td"><Link href={`/projects/${p.id}`} className="font-medium hover:text-accent-2">{p.name}</Link>
                        <div className="text-[11px] text-ink-3">P-{p.ref} · {company.get(p.company_id ?? "")?.name}</div></td>
                      <td className="td"><StatusChip status={slipping && p.status === "active" ? "at_risk" : p.status} /></td>
                      <td className="td w-[160px]"><div className="flex items-center gap-2"><Meter value={done} max={ms.length || 1} tone={slipping ? "bad" : "accent"} /><span className="text-[12px] tabular-nums text-ink-3">{done}/{ms.length}</span></div></td>
                      <td className="td">{next ? <span className={isSlipping(next) ? "text-rose-300" : ""}>{next.title} · {shortDate(next.due_date)}</span> : <span className="text-ink-3">—</span>}</td>
                      <td className="td">{owes.length ? <span className="text-amber-300">{owes.length} item{owes.length > 1 && "s"}</span> : <span className="text-ink-3">—</span>}</td>
                      <td className="td text-ink-2">{shortDate(p.target_date)}</td>
                      <td className="td text-ink-3">{monthLabel(p.slot_month)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

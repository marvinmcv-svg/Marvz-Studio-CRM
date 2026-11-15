import { Users } from "lucide-react";
import { AgentAvatar, Chip, PageHeader } from "@/components/ui";
import { OWNERS } from "@/lib/types";
import { AGENT_RPCS, SHARED_RPCS } from "@/lib/agent-api";
import { getTables } from "@/lib/data";
import { relTime } from "@/lib/format";

export const metadata = { title: "Team & API" };

export default async function TeamPage() {
  const t = await getTables("agents", "activity_log", "leads", "escalations");
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  return (
    <div>
      <PageHeader title="Team & agent API" icon={<Users size={18} className="text-ink-3" />}
        subtitle="Each Grokbot agent signs in as its own Supabase user, so Row Level Security knows who it is. One RPC per step; every call is logged." />
      <div className="grid gap-3 p-4 md:grid-cols-2 md:p-6 xl:grid-cols-3">
        {t.agents.map((a) => {
          const acts = t.activity_log.filter((x) => x.agent_code === a.code);
          return (
            <article key={a.code} className="card flex flex-col">
              <div className="flex items-start gap-3 p-4">
                <AgentAvatar agent={a} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="font-semibold">{a.name}</span><Chip tone={!a.active ? "slate" : OWNERS.includes(a.code) ? "amber" : "accent"}>{!a.active ? "Inactive" : OWNERS.includes(a.code) ? "Human · owner" : a.kind === "human" ? "Human" : "AI agent"}</Chip></div>
                  <div className="text-[12px] text-ink-3">{a.title} · <code>{a.code}</code></div>
                  <p className="mt-1.5 text-ink-2">{a.description}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 border-y border-line text-center">
                <div className="px-2 py-2"><div className="font-semibold tabular-nums">{acts.filter((x) => x.created_at >= weekAgo).length}</div><div className="text-[11px] text-ink-3">actions 7d</div></div>
                <div className="border-x border-line px-2 py-2"><div className="font-semibold tabular-nums">{t.leads.filter((l) => l.owner_agent === a.code).length}</div><div className="text-[11px] text-ink-3">leads owned</div></div>
                <div className="px-2 py-2"><div className="font-semibold tabular-nums">{t.escalations.filter((e) => e.raised_by === a.code).length}</div><div className="text-[11px] text-ink-3">escalations</div></div>
              </div>
              <ul className="flex-1 space-y-1.5 p-4">
                {(AGENT_RPCS[a.code] ?? []).map((r) => (
                  <li key={r.fn} className="text-[12px]"><code className="rounded bg-panel-3 px-1 py-px text-accent-2">{r.fn}</code> <span className="text-ink-2">{r.does}</span></li>
                ))}
              </ul>
              <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Last active {relTime(acts[0]?.created_at)}</div>
            </article>
          );
        })}
        <article className="card p-4 md:col-span-2 xl:col-span-3">
          <div className="card-t mb-2">Shared by everyone</div>
          <div className="flex flex-wrap gap-1.5">{SHARED_RPCS.map((f) => <code key={f} className="rounded bg-panel-3 px-1.5 py-0.5 text-[12px] text-accent-2">{f}</code>)}</div>
          <p className="mt-3 text-[12px] text-ink-3">Full reference with arguments and example payloads: <code className="text-ink-2">docs/AGENT_API.md</code>. Connecting Grokbot: <code className="text-ink-2">README.md</code>.</p>
        </article>
      </div>
    </div>
  );
}

import clsx from "clsx";
import { Activity } from "lucide-react";
import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed";
import { AgentAvatar, PageHeader } from "@/components/ui";
import { getTables } from "@/lib/data";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ agent?: string; action?: string; limit?: string }> }) {
  const sp = await searchParams;
  const t = await getTables("activity_log", "agents");
  const limit = Math.min(Number(sp.limit) || 100, 1500);
  const rows = t.activity_log.filter((a) => (!sp.agent || a.agent_code === sp.agent) && (!sp.action || a.action === sp.action));
  const actions = [...new Set(t.activity_log.map((a) => a.action))].sort();
  const href = (patch: Record<string, string | undefined>) => ({ query: Object.fromEntries(Object.entries({ ...sp, ...patch }).filter(([, v]) => v)) });

  return (
    <div>
      <PageHeader title="Activity log" icon={<Activity size={18} className="text-ink-3" />}
        subtitle={`${rows.length} events · append-only — every agent call writes here and cannot be edited`} />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5 md:px-6">
        <Link href={href({ agent: undefined })} className={clsx("btn-ghost h-7", !sp.agent && "bg-panel-3 text-ink")}>Everyone</Link>
        {t.agents.map((a) => (
          <Link key={a.code} href={href({ agent: a.code })} className={clsx("btn-ghost h-7", sp.agent === a.code && "bg-panel-3 text-ink")}>
            <AgentAvatar agent={a} size={16} /> {a.name}
          </Link>
        ))}
        <form className="ml-auto" action="/activity">
          {sp.agent && <input type="hidden" name="agent" value={sp.agent} />}
          <select name="action" defaultValue={sp.action ?? ""} className="input w-auto" aria-label="Filter by action">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button className="btn ml-1.5 h-8">Apply</button>
        </form>
      </div>
      <div className="p-4 md:p-6">
        <div className="card py-1"><ActivityFeed items={rows.slice(0, limit)} agents={t.agents} /></div>
        {rows.length > limit && (
          <div className="mt-3 text-center"><Link href={href({ limit: String(limit + 200) })} className="btn">Load more</Link></div>
        )}
      </div>
    </div>
  );
}

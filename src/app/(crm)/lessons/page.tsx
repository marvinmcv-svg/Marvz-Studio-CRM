import clsx from "clsx";
import { BookOpen, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { AgentAvatar, Chip, Empty, PageHeader } from "@/components/ui";
import { getTables } from "@/lib/data";
import { relTime } from "@/lib/format";

export const metadata = { title: "Lessons" };

export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const t = await getTables("lessons", "agents");
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  const cats = [...new Set(t.lessons.map((l) => l.category))];
  const lessons = t.lessons.filter((l) => !category || l.category === category).sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <div>
      <PageHeader title="Lessons library" icon={<BookOpen size={18} className="text-ink-3" />}
        subtitle={<span className="inline-flex items-center gap-1.5"><ShieldCheck size={12} className="text-emerald-300" /> Anonymised learnings from Dana for Hunter & Jordan. The database rejects lessons with client names, emails, phones, URLs or handles.</span>} />
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5 md:px-8">
        <Link href="/lessons" className={clsx("btn-ghost h-7", !category && "bg-panel-3 text-ink")}>All</Link>
        {cats.map((c) => <Link key={c} href={`/lessons?category=${c}`} className={clsx("btn-ghost h-7 capitalize", category === c && "bg-panel-3 text-ink")}>{c}</Link>)}
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 md:p-8 xl:grid-cols-3">
        {lessons.length === 0 && <div className="card md:col-span-2 xl:col-span-3"><Empty title="No lessons yet">Dana adds them with add_lesson after each project.</Empty></div>}
        {lessons.map((l) => (
          <article key={l.id} className="card flex flex-col p-4">
            <div className="flex flex-wrap items-center gap-1.5"><Chip tone="violet">{l.category}</Chip>{l.industry && <Chip>{l.industry}</Chip>}</div>
            <h2 className="mt-2 font-semibold">{l.title}</h2>
            <p className="mt-1.5 flex-1 text-ink-2">{l.body}</p>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
              <AgentAvatar agent={agent.get(l.created_by ?? "dana")} size={16} withName /> · {relTime(l.created_at)}
              <span className="ml-auto">for {l.audience.join(" & ")}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

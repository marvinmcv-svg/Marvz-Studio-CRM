import { HeartHandshake, Star } from "lucide-react";
import Link from "next/link";
import { Empty, PageHeader, Stat, StatusChip } from "@/components/ui";
import { getTables } from "@/lib/data";
import { relTime } from "@/lib/format";

export const metadata = { title: "Testimonials & referrals" };

export default async function GrowthPage() {
  const t = await getTables("testimonials", "referrals", "companies", "projects");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const project = new Map(t.projects.map((p) => [p.id, p]));
  const received = t.testimonials.filter((x) => ["received", "published"].includes(x.status));
  return (
    <div>
      <PageHeader title="Testimonials & referrals" icon={<HeartHandshake size={18} className="text-ink-3" />} subtitle="Dana asks every delivered client for a testimonial and a referral" />
      <div className="grid gap-4 p-4 md:p-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Testimonials received" value={received.length} hint={`${t.testimonials.length} asked/queued`} />
          <Stat label="Avg rating" value={received.length ? (received.reduce((a, x) => a + (x.rating ?? 0), 0) / received.length).toFixed(1) + " ★" : "—"} />
          <Stat label="Referrals" value={t.referrals.length} hint={`${t.referrals.filter((r) => r.status === "converted").length} converted`} />
          <Stat label="Can publish" value={received.filter((x) => x.permission_to_publish).length} />
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <section className="card">
            <div className="card-h"><span className="card-t">Testimonials</span></div>
            {t.testimonials.length === 0 ? <Empty title="None yet" /> : t.testimonials.map((x) => (
              <div key={x.id} className="border-b border-line/60 px-4 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{company.get(x.company_id ?? "")?.name}</span>
                  <StatusChip status={x.status} />
                  {x.rating && <span className="flex text-amber-300">{Array.from({ length: x.rating }).map((_, i) => <Star key={i} size={12} fill="currentColor" />)}</span>}
                  {x.permission_to_publish && <span className="text-[11px] text-emerald-300">ok to publish</span>}
                  {x.project_id && <Link href={`/projects/${x.project_id}`} className="ml-auto text-[12px] text-ink-3 hover:text-ink">P-{project.get(x.project_id)?.ref}</Link>}
                </div>
                {x.quote && <blockquote className="mt-2 border-l-2 border-accent/50 pl-3 text-ink-2">“{x.quote}” <span className="text-ink-3">— {x.author_name}, {x.author_role}</span></blockquote>}
              </div>
            ))}
          </section>
          <section className="card">
            <div className="card-h"><span className="card-t">Referrals</span></div>
            {t.referrals.length === 0 ? <Empty title="None yet" /> : t.referrals.map((r) => (
              <div key={r.id} className="border-b border-line/60 px-4 py-3 last:border-0">
                <div className="flex items-center gap-2"><StatusChip status={r.status} /><span className="font-medium">{r.referred_name ?? "Asked, waiting"}</span><span className="ml-auto text-[12px] text-ink-3">{relTime(r.created_at)}</span></div>
                <div className="mt-1 text-[12px] text-ink-3">from {company.get(r.from_company_id ?? "")?.name}{r.notes && ` · ${r.notes}`}</div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

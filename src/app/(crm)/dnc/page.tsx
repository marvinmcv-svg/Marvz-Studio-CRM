import { Ban } from "lucide-react";
import Link from "next/link";
import { DncForm } from "@/components/dnc-form";
import { AgentAvatar, Chip, Empty, PageHeader } from "@/components/ui";
import { getMe, getTables } from "@/lib/data";
import { relTime } from "@/lib/format";

export const metadata = { title: "Do not contact" };

export default async function DncPage() {
  const me = await getMe();
  const t = await getTables("do_not_contact", "agents");
  const agent = new Map(t.agents.map((a) => [a.code, a]));
  return (
    <div>
      <PageHeader title="Do-not-contact list" icon={<Ban size={18} className="text-ink-3" />}
        subtitle="create_lead refuses anything matching a business name, email, phone, domain or Instagram handle on this list (accents and formatting ignored)" />
      <div className="grid gap-4 p-4 md:p-6">
        <section className="card"><div className="card-h"><span className="card-t">Add entry</span></div><DncForm disabled={!!me?.demo} /></section>
        <section className="card overflow-x-auto">
          {t.do_not_contact.length === 0 ? <Empty title="List is empty" /> : (
            <table className="w-full min-w-[640px]">
              <thead><tr className="border-b border-line">{["Type", "Value", "Reason", "Added by", "When"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {t.do_not_contact.map((d) => (
                  <tr key={d.id} className="table-row">
                    <td className="td"><Chip tone="red">{d.kind}</Chip></td>
                    <td className="td font-medium">{d.lead_id ? <Link href={`/leads/${d.lead_id}`} className="hover:text-accent-2">{d.value}</Link> : d.value}</td>
                    <td className="td text-ink-2">{d.reason}</td>
                    <td className="td"><AgentAvatar agent={d.added_by ? agent.get(d.added_by) : null} withName /></td>
                    <td className="td text-ink-3">{relTime(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/live-refresh";
import { Shell } from "@/components/shell";
import { getAuthState, getMe, getTables } from "@/lib/data";
import { isSlipping, openEscalations } from "@/lib/metrics";
import { isLive } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect((await getAuthState()) === "not_linked" ? "/login?reason=not_linked" : "/login");
  const t = await getTables("agents", "leads", "companies", "approval_batches", "escalations", "milestones");
  const companies = new Map(t.companies.map((c) => [c.id, c]));
  const leads = t.leads.map((l) => ({
    id: l.id, code: `SQ-${l.ref}`, name: companies.get(l.company_id)?.name ?? "Unknown", stage: l.stage,
    city: companies.get(l.company_id)?.city ?? null,
  }));
  const open = openEscalations(t.escalations);
  const agent = t.agents.find((a) => a.code === me.code);
  return (
    <Shell
      demo={me.demo}
      me={{ name: me.name, code: me.code, color: agent?.color ?? "#8b7cff" }}
      leads={leads}
      badges={{
        approvals: t.approval_batches.filter((b) => b.status === "pending").length,
        escalations: open.length,
        ownerEscalations: open.filter((e) => e.status === "with_owner" || e.status === "with_letty").length,
        slipping: t.milestones.filter(isSlipping).length,
      }}
    >
      {isLive && <LiveRefresh />}
      {children}
    </Shell>
  );
}

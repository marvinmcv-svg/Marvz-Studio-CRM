import { DealBuilder } from "@/components/deal-builder";
import { PageHeader } from "@/components/ui";
import { getMe, getTables } from "@/lib/data";
import { capacity, capacityLimit } from "@/lib/metrics";

export const metadata = { title: "Deal builder" };

export default async function DealBuilderPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead } = await searchParams;
  const me = await getMe();
  const t = await getTables("markets", "catalogue_packages", "catalogue_package_prices", "catalogue_addons", "catalogue_care_plans",
    "catalogue_terms", "leads", "companies", "projects");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const leads = t.leads
    .filter((l) => !["lost", "do_not_contact"].includes(l.stage))
    .map((l) => ({ id: l.id, label: `${company.get(l.company_id)?.name} · SQ-${l.ref} (${l.stage.replace(/_/g, " ")})`, market: l.market_code, interest: l.service_interest }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const rush = (t.catalogue_terms.find((x) => x.key === "rush")?.value as { percent?: number } | undefined)?.percent ?? 25;
  const cap = capacity(t.projects, capacityLimit(t.catalogue_terms));
  return (
    <div>
      <PageHeader title="Deal builder" subtitle="Package + add-ons + market + payment plan + rush → quote and payment milestones. Saving re-quotes in the database." />
      <DealBuilder
        cat={{ markets: t.markets.sort((a, b) => a.sort - b.sort), packages: t.catalogue_packages, prices: t.catalogue_package_prices, addons: t.catalogue_addons, carePlans: t.catalogue_care_plans.sort((a, b) => a.sort - b.sort) }}
        leads={leads} initialLead={lead ?? null} demo={!!me?.demo} rushPercent={rush} capacity={{ used: cap.used, limit: cap.limit }}
      />
    </div>
  );
}

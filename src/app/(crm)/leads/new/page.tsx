import { LeadForm } from "@/components/lead-form";
import { PageHeader } from "@/components/ui";
import { getMe, getTables } from "@/lib/data";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const me = await getMe();
  const t = await getTables("markets", "catalogue_packages", "catalogue_addons", "leads", "companies", "contacts");
  const company = new Map(t.companies.map((c) => [c.id, c]));
  const contact = new Map(t.contacts.map((c) => [c.id, c]));
  const services = [
    ...t.catalogue_packages.sort((a, b) => a.sort - b.sort).map((p) => ({ code: p.code, name: p.name })),
    ...t.catalogue_addons.sort((a, b) => a.sort - b.sort).map((a) => ({ code: a.code, name: a.name })),
  ];
  const existing = t.leads.map((l) => ({
    id: l.id, code: `SQ-${l.ref}`, name: company.get(l.company_id)?.name ?? "", stage: l.stage,
    email: contact.get(l.contact_id ?? "")?.email ?? null, phone: contact.get(l.contact_id ?? "")?.phone ?? null,
  }));
  return (
    <div>
      <PageHeader title="New lead" subtitle="Duplicates and the do-not-contact list are checked as you type" />
      <LeadForm markets={t.markets.sort((a, b) => a.sort - b.sort).map((m) => ({ code: m.code, name: m.name }))} services={services} existing={existing} demo={!!me?.demo} />
    </div>
  );
}

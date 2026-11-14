"use client";

import clsx from "clsx";
import {
  Activity, AlertTriangle, BookOpen, Calculator, CheckCheck, Command, FolderKanban, Gauge, HeartHandshake,
  Kanban, LifeBuoy, LogOut, Menu, Ban, Package, Plus, Search, Sparkles, TrendingUp, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type NavItem = { href: string; label: string; icon: ReactNode; key?: string; badge?: number; badgeTone?: "warn" | "bad" };
export type LeadIndex = { id: string; code: string; name: string; stage: string; city: string | null };

export function Shell({
  children, badges, leads, me, demo,
}: {
  children: ReactNode;
  badges: { approvals: number; escalations: number; lettyEscalations: number; slipping: number };
  leads: LeadIndex[];
  me: { name: string; code: string; color: string };
  demo: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const sections: { title?: string; items: NavItem[] }[] = useMemo(() => [
    {
      items: [
        { href: "/", label: "Overview", icon: <Gauge size={15} />, key: "o" },
        { href: "/pipeline", label: "Pipeline", icon: <Kanban size={15} />, key: "p" },
        { href: "/approvals", label: "Approvals", icon: <CheckCheck size={15} />, key: "a", badge: badges.approvals, badgeTone: "warn" },
        { href: "/escalations", label: "Escalations", icon: <AlertTriangle size={15} />, key: "e", badge: badges.escalations, badgeTone: badges.lettyEscalations ? "bad" : "warn" },
        { href: "/activity", label: "Activity log", icon: <Activity size={15} />, key: "l" },
      ],
    },
    {
      title: "Deals & delivery",
      items: [
        { href: "/deals", label: "Deals", icon: <Calculator size={15} />, key: "d" },
        { href: "/projects", label: "Projects", icon: <FolderKanban size={15} />, key: "j", badge: badges.slipping, badgeTone: "bad" },
        { href: "/catalogue", label: "Catalogue", icon: <Package size={15} />, key: "c" },
      ],
    },
    {
      title: "Growth",
      items: [
        { href: "/revenue", label: "Revenue", icon: <TrendingUp size={15} />, key: "r" },
        { href: "/care", label: "Care plans", icon: <LifeBuoy size={15} />, key: "k" },
        { href: "/growth", label: "Testimonials", icon: <HeartHandshake size={15} />, key: "t" },
        { href: "/lessons", label: "Lessons", icon: <BookOpen size={15} />, key: "s" },
        { href: "/dnc", label: "Do not contact", icon: <Ban size={15} /> },
      ],
    },
    { title: "Squad", items: [{ href: "/team", label: "Team & API", icon: <Users size={15} />, key: "m" }] },
  ], [badges]);

  const flat = sections.flatMap((s) => s.items);

  // ---- keyboard shortcuts: g + key to navigate, n = new lead, b = deal builder, / or ⌘K palette, ? help
  const gPressed = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (e.key === "Escape") { setPaletteOpen(false); setHelpOpen(false); setDrawer(false); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); setPaletteOpen(true); return; }
      if (e.key === "?") { setHelpOpen((v) => !v); return; }
      if (Date.now() - gPressed.current < 900) {
        const hit = flat.find((i) => i.key === e.key);
        gPressed.current = 0;
        if (hit) { e.preventDefault(); router.push(hit.href); }
        return;
      }
      if (e.key === "g") { gPressed.current = Date.now(); return; }
      if (e.key === "n") { e.preventDefault(); router.push("/leads/new"); return; }
      if (e.key === "b") { e.preventDefault(); router.push("/deals/new"); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, router]);

  useEffect(() => setDrawer(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const nav = (
    <nav className="flex flex-col gap-4 px-2 py-3">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">{s.title}</div>}
          <ul className="flex flex-col gap-px">
            {s.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href}
                  className={clsx("group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px]",
                    isActive(it.href) ? "bg-panel-3 text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
                  <span className={clsx(isActive(it.href) ? "text-accent-2" : "text-ink-3 group-hover:text-ink-2")}>{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {!!it.badge && (
                    <span className={clsx("rounded-md px-1.5 text-[11px] font-semibold tabular-nums",
                      it.badgeTone === "bad" ? "bg-rose-400/15 text-rose-300" : "bg-amber-400/15 text-amber-300")}>{it.badge}</span>
                  )}
                  {it.key && !it.badge && <span className="hidden text-[10px] text-ink-3 opacity-0 group-hover:opacity-100 lg:inline">g {it.key}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2 px-2">
      <span className="flex size-6 items-center justify-center rounded-md bg-accent text-accent-ink"><Sparkles size={14} strokeWidth={2.5} /></span>
      <span className="font-semibold tracking-tight">Squad CRM</span>
      <span className="text-[11px] text-ink-3">Marvz Studio</span>
    </Link>
  );

  const footer = (
    <div className="border-t border-line p-2">
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
        <span className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold text-black/80" style={{ background: me.color }}>
          {me.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]">{me.name}</div>
          <div className="truncate text-[11px] text-ink-3">{demo ? "Demo mode · read-only" : me.code === "letty" ? "Owner" : me.code}</div>
        </div>
        {!demo && (
          <form action="/auth/signout" method="post">
            <button className="btn-ghost h-7 px-1.5" title="Sign out"><LogOut size={14} /></button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-panel/60 md:flex">
        <div className="flex h-12 items-center border-b border-line px-2">{brand}</div>
        <button onClick={() => setPaletteOpen(true)}
          className="mx-2 mt-3 flex h-8 items-center gap-2 rounded-lg border border-line bg-panel-2 px-2 text-ink-3 hover:text-ink-2">
          <Search size={14} /> <span className="flex-1 text-left">Search or jump…</span>
          <span className="kbd">⌘K</span>
        </button>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="px-3 pb-2 text-[11px] text-ink-3">
          Press <span className="kbd">?</span> for shortcuts
        </div>
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[270px] flex-col border-r border-line bg-panel">
            <div className="flex h-12 items-center justify-between border-b border-line px-2">
              {brand}
              <button className="btn-ghost" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-bg/90 px-2 backdrop-blur md:hidden">
          <button className="btn-ghost" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={18} /></button>
          {brand}
          <div className="flex-1" />
          <button className="btn-ghost" onClick={() => setPaletteOpen(true)} aria-label="Search"><Search size={17} /></button>
          <Link href="/leads/new" className="btn-ghost" aria-label="New lead"><Plus size={18} /></Link>
        </header>

        {demo && (
          <div className="border-b border-accent/20 bg-accent/[0.07] px-4 py-1.5 text-[12px] text-accent-2 md:px-6">
            Demo mode — showing sample data. Add your Supabase keys (see README) to go live; changes are disabled until then.
          </div>
        )}

        <main className="min-w-0 flex-1 pb-20 md:pb-8">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {[flat[0], flat[1], flat[2], flat[3], flat[6]].map((it) => (
            <Link key={it.href} href={it.href}
              className={clsx("relative flex flex-col items-center gap-0.5 py-2 text-[10px]", isActive(it.href) ? "text-accent-2" : "text-ink-3")}>
              {it.icon}
              {it.label.split(" ")[0]}
              {!!it.badge && <span className="absolute right-[22%] top-1 size-1.5 rounded-full bg-amber-400" />}
            </Link>
          ))}
        </nav>
      </div>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} nav={flat} leads={leads} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} nav={flat} />}
    </div>
  );
}

function Palette({ onClose, nav, leads }: { onClose: () => void; nav: NavItem[]; leads: LeadIndex[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const actions = [
      { id: "new-lead", label: "Create lead", hint: "n", href: "/leads/new", icon: <Plus size={14} /> },
      { id: "new-deal", label: "Open deal builder", hint: "b", href: "/deals/new", icon: <Calculator size={14} /> },
    ];
    const pages = nav.map((n) => ({ id: n.href, label: n.label, hint: n.key ? `g ${n.key}` : "", href: n.href, icon: n.icon }));
    const leadItems = leads.map((l) => ({
      id: l.id, label: l.name, hint: `${l.code} · ${l.stage.replace(/_/g, " ")}`, href: `/leads/${l.id}`, icon: <Command size={14} />,
      haystack: `${l.name} ${l.code} ${l.city ?? ""}`.toLowerCase(),
    }));
    if (!ql) return [...actions, ...pages, ...leadItems.slice(0, 6)];
    return [...actions, ...pages, ...leadItems].filter((i) =>
      ("haystack" in i ? (i as { haystack: string }).haystack : i.label.toLowerCase()).includes(ql)).slice(0, 12);
  }, [q, nav, leads]);

  const go = useCallback((href: string) => { onClose(); router.push(href); }, [onClose, router]);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-3 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line-2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-ink-3" />
          <input autoFocus value={q} placeholder="Search leads, pages, actions…"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && items[sel]) go(items[sel].href);
            }}
            className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3" />
          <span className="kbd">esc</span>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-6 text-center text-ink-3">No matches</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(it.href)}
                className={clsx("flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left", i === sel ? "bg-panel-3 text-ink" : "text-ink-2")}>
                <span className="text-ink-3">{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className="text-[11px] text-ink-3">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ShortcutHelp({ onClose, nav }: { onClose: () => void; nav: NavItem[] }) {
  const rows: [string, string][] = [
    ["⌘K or /", "Search & command palette"],
    ["n", "New lead"],
    ["b", "Deal builder"],
    ...nav.filter((n) => n.key).map((n) => [`g ${n.key}`, n.label] as [string, string]),
    ["?", "Toggle this help"],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-3" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-xl border border-line-2 bg-panel p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 font-semibold">Keyboard shortcuts</div>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <div className="flex gap-1">{k.split(" ").map((p, i) => <span key={i} className="kbd">{p}</span>)}</div>
              <div className="text-ink-2">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

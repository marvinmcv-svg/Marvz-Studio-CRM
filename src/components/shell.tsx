"use client";

import clsx from "clsx";
import {
  Activity, AlertTriangle, BookOpen, Calculator, CheckCheck, Command, FolderKanban, Gauge, HeartHandshake,
  Kanban, LifeBuoy, LogOut, Menu, Ban, Package, Plus, Search, Sparkles, TrendingUp, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { InstallApp, ThemeSwitch } from "./app-chrome";

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
          {s.title && <div className="px-2.5 pb-1.5 text-[12px] font-semibold text-ink-3">{s.title}</div>}
          <ul className="flex flex-col gap-px">
            {s.items.map((it) => (
              <li key={it.href}>
                <Link href={it.href} aria-current={isActive(it.href) ? "page" : undefined}
                  className={clsx("group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[14px] transition-colors",
                    isActive(it.href) ? "bg-accent text-accent-ink shadow-[0_4px_12px_-4px_var(--color-accent)]" : "text-ink hover:bg-panel-3/70")}>
                  <span className={clsx(isActive(it.href) ? "text-accent-ink" : "text-accent")}>{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {!!it.badge && (
                    <span className={clsx("min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
                      isActive(it.href) ? "bg-white/25 text-white" : it.badgeTone === "bad" ? "bg-rose-500 text-white" : "bg-amber-500 text-white")}>{it.badge}</span>
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
    <Link href="/" className="flex items-center gap-2.5 px-1.5">
      <span className="flex size-8 items-center justify-center rounded-[9px] text-white shadow-[0_4px_12px_-4px_rgb(10_132_255/0.7)]"
        style={{ background: "linear-gradient(135deg,#5ac8fa 0%,#0a84ff 45%,#5e5ce6 100%)" }}>
        <Sparkles size={16} strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">Squad CRM</span>
        <span className="block text-[11px] text-ink-3">Marvz Studio</span>
      </span>
    </Link>
  );

  const footer = (
    <div className="space-y-2 border-t border-line p-3">
      <InstallApp />
      <ThemeSwitch />
      <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
        <span className="flex size-8 items-center justify-center rounded-full text-[13px] font-semibold text-black/80 shadow-sm" style={{ background: me.color }}>
          {me.name[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{me.name}</div>
          <div className="truncate text-[11px] text-ink-3">{demo ? "Demo mode · read-only" : me.code === "letty" ? "Owner" : me.code === "marvin" ? "Admin" : me.code}</div>
        </div>
        {!demo && (
          <form action="/auth/signout" method="post">
            <button className="btn-ghost h-8 w-8 px-0" title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="glass sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r border-line md:flex">
        <div className="flex h-16 items-center px-3">{brand}</div>
        <button onClick={() => setPaletteOpen(true)}
          className="mx-3 flex h-9 items-center gap-2 rounded-[10px] bg-panel-3/70 px-2.5 text-[14px] text-ink-3 transition-colors hover:text-ink-2">
          <Search size={15} /> <span className="flex-1 text-left">Search</span>
          <span className="kbd">⌘K</span>
        </button>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="px-4 pb-2 text-[12px] text-ink-3">
          Press <span className="kbd">?</span> for shortcuts
        </div>
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="float absolute inset-y-0 left-0 flex w-[290px] flex-col rounded-r-[22px] border-y-0 border-l-0 pt-[env(safe-area-inset-top)]">
            <div className="flex h-16 items-center justify-between px-3">
              {brand}
              <button className="btn-ghost w-11 px-0" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="glass sticky top-0 z-30 border-b border-line pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-1 px-2">
            <button className="btn-ghost w-11 px-0 text-accent" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={21} /></button>
            {brand}
            <div className="flex-1" />
            <button className="btn-ghost w-11 px-0 text-accent" onClick={() => setPaletteOpen(true)} aria-label="Search"><Search size={20} /></button>
            <Link href="/leads/new" className="btn-ghost w-11 px-0 text-accent" aria-label="New lead"><Plus size={22} /></Link>
          </div>
        </header>

        {demo && (
          <div className="border-b border-accent/20 bg-accent/10 px-4 py-2 text-[12.5px] text-accent md:px-8">
            Demo mode · sample data, read-only.
          </div>
        )}

        <main className="min-w-0 flex-1 pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-10">{children}</main>

        {/* Mobile bottom nav */}
        <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
          {[flat[0], flat[1], flat[2], flat[3], flat[6]].map((it) => (
            <Link key={it.href} href={it.href} aria-current={isActive(it.href) ? "page" : undefined}
              className={clsx("relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium [&_svg]:size-[22px]",
                isActive(it.href) ? "text-accent" : "text-ink-3")}>
              {it.icon}
              {it.label.split(" ")[0]}
              {!!it.badge && (
                <span className="absolute left-1/2 top-1 ml-1.5 min-w-[17px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[17px] text-white">{it.badge}</span>
              )}
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
    <div data-modal-open className="fixed inset-0 z-[60] flex items-start justify-center bg-black/35 px-3 pt-[12vh] backdrop-blur-[2px]" onClick={onClose}>
      <div className="float w-full max-w-[600px] overflow-hidden rounded-[20px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={18} className="text-ink-3" />
          <input autoFocus value={q} placeholder="Search leads, pages, actions…"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && items[sel]) go(items[sel].href);
            }}
            aria-label="Search" className="h-14 flex-1 bg-transparent text-[17px] outline-none placeholder:text-ink-3" />
          <span className="kbd">esc</span>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-ink-3">No matches</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              <button onMouseEnter={() => setSel(i)} onClick={() => go(it.href)}
                className={clsx("flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-left text-[14px]", i === sel ? "bg-accent text-accent-ink" : "text-ink")}>
                <span className={i === sel ? "text-accent-ink" : "text-accent"}>{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className={clsx("text-[12px]", i === sel ? "text-white/75" : "text-ink-3")}>{it.hint}</span>
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
    <div data-modal-open className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 px-3 backdrop-blur-[2px]" onClick={onClose}>
      <div className="float w-full max-w-[440px] rounded-[22px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 text-[17px] font-semibold">Keyboard shortcuts</div>
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

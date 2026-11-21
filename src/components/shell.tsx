"use client";

import clsx from "clsx";
import {
  Activity, AlertTriangle, ArrowRight, Ban, BookOpen, Bot, Calculator, CheckCheck, ChevronRight, CornerDownLeft,
  FolderKanban, HeartHandshake, Kanban, LayoutDashboard, LifeBuoy, LogOut, Menu, Package, Plus, Search, TrendingUp,
  User, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { InstallApp, ThemeSwitch } from "./app-chrome";
import { AgentAvatar } from "./ui";

type NavItem = { href: string; label: string; icon: ReactNode; key?: string; badge?: number; badgeTone?: "warn" | "bad" };
export type LeadIndex = { id: string; code: string; name: string; stage: string; city: string | null };
export type SquadMember = {
  code: string; name: string; title: string; color: string; kind: "human" | "ai";
  lastAt: string | null; lastSummary: string | null;
};

const LIVE_MS = 60 * 60 * 1000;

function ago(iso: string | null, now: number) {
  if (!iso || !now) return "idle";
  const m = Math.round((now - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function BrandMark({ size = 28 }: { size?: number }) {
  // unique gradient id: a copy inside a hidden sidebar would otherwise blank every other copy
  const gid = `bm${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-[28%] border border-white/10"
      style={{ width: size, height: size, background: "radial-gradient(circle at 50% 40%, rgb(124 92 255 / 0.5), transparent 70%), linear-gradient(180deg,#1c1c24,#09090b)" }}>
      <svg viewBox="0 0 512 512" width={size * 0.66} height={size * 0.66} aria-hidden>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c4b5ff" /><stop offset="0.5" stopColor="#7c5cff" /><stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <path fill={`url(#${gid})`} d="M256 40c13 0 24 9 26 22l22 120c4 20 19 35 39 39l120 22c13 2 22 13 22 26s-9 24-22 26l-120 22c-20 4-35 19-39 39l-22 120c-2 13-13 22-26 22s-24-9-26-22l-22-120c-4-20-19-35-39-39L49 314c-13-2-22-13-22-26s9-24 22-26l120-22c20-4 35-19 39-39l22-120c2-13 13-22 26-22z" />
      </svg>
    </span>
  );
}

export function Shell({
  children, badges, leads, me, demo, squad,
}: {
  children: ReactNode;
  badges: { approvals: number; escalations: number; lettyEscalations: number; slipping: number };
  leads: LeadIndex[];
  me: { name: string; code: string; color: string };
  demo: boolean;
  squad: SquadMember[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // "now" is set after mount so server and client render the same markup
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const sections: { title?: string; items: NavItem[] }[] = useMemo(() => [
    {
      items: [
        { href: "/", label: "Overview", icon: <LayoutDashboard size={15} />, key: "o" },
        { href: "/pipeline", label: "Pipeline", icon: <Kanban size={15} />, key: "p" },
        { href: "/approvals", label: "Approvals", icon: <CheckCheck size={15} />, key: "a", badge: badges.approvals, badgeTone: "warn" },
        { href: "/escalations", label: "Escalations", icon: <AlertTriangle size={15} />, key: "e", badge: badges.escalations, badgeTone: badges.lettyEscalations ? "bad" : "warn" },
        { href: "/activity", label: "Activity log", icon: <Activity size={15} />, key: "l" },
      ],
    },
    {
      title: "Revenue",
      items: [
        { href: "/deals", label: "Deals", icon: <Calculator size={15} />, key: "d" },
        { href: "/projects", label: "Projects", icon: <FolderKanban size={15} />, key: "j", badge: badges.slipping, badgeTone: "bad" },
        { href: "/revenue", label: "Revenue", icon: <TrendingUp size={15} />, key: "r" },
        { href: "/care", label: "Care plans", icon: <LifeBuoy size={15} />, key: "k" },
        { href: "/catalogue", label: "Catalogue", icon: <Package size={15} />, key: "c" },
      ],
    },
    {
      title: "Knowledge",
      items: [
        { href: "/growth", label: "Testimonials", icon: <HeartHandshake size={15} />, key: "t" },
        { href: "/lessons", label: "Lessons", icon: <BookOpen size={15} />, key: "s" },
        { href: "/dnc", label: "Do not contact", icon: <Ban size={15} /> },
        { href: "/team", label: "Team & API", icon: <Users size={15} />, key: "m" },
      ],
    },
  ], [badges]);

  const flat = sections.flatMap((s) => s.items);
  const onlineCount = now ? squad.filter((a) => a.lastAt && now - new Date(a.lastAt).getTime() < LIVE_MS).length : 0;

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
  const current = flat.find((i) => isActive(i.href))
    ?? (pathname.startsWith("/leads") ? flat.find((i) => i.href === "/pipeline") : undefined);
  const crumb = pathname.startsWith("/leads/new") ? "New lead" : pathname.startsWith("/leads/") ? "Lead"
    : pathname.startsWith("/deals/new") ? "Deal builder" : pathname.match(/^\/projects\/./) ? "Project" : null;

  const nav = (
    <nav className="flex flex-col gap-5 px-2.5 py-2">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <div className="eyebrow px-2 pb-1.5">{s.title}</div>}
          <ul className="flex flex-col gap-px">
            {s.items.map((it) => {
              const on = isActive(it.href);
              return (
                <li key={it.href}>
                  <Link href={it.href} aria-current={on ? "page" : undefined}
                    className={clsx("group relative flex h-8 items-center gap-2.5 rounded-[7px] px-2 text-[13px] transition-colors",
                      on ? "bg-panel-3 font-medium text-ink" : "text-ink-2 hover:bg-panel-2 hover:text-ink")}>
                    {on && <span className="absolute -left-2.5 top-1.5 bottom-1.5 w-[2px] rounded-r bg-accent" />}
                    <span className={clsx("transition-colors", on ? "text-accent-2" : "text-ink-3 group-hover:text-ink-2")}>{it.icon}</span>
                    <span className="flex-1 truncate">{it.label}</span>
                    {!!it.badge && (
                      <span className={clsx("min-w-[18px] rounded-[5px] px-1 text-center text-[11px] font-semibold tabular-nums leading-[18px]",
                        it.badgeTone === "bad" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300")}>{it.badge}</span>
                    )}
                    {it.key && !it.badge && <span className="hidden text-[10.5px] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 lg:inline">g {it.key}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {/* Agent roster */}
      <div>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <span className="eyebrow">Agents</span>
          <span className="flex items-center gap-1 text-[10.5px] text-ink-3">
            <span className={clsx("size-1.5 rounded-full", onlineCount ? "bg-emerald-400" : "bg-ink-3")} />{onlineCount}/{squad.length} live
          </span>
        </div>
        <ul className="flex flex-col gap-px">
          {squad.map((a) => {
            const live = !!(now && a.lastAt && now - new Date(a.lastAt).getTime() < LIVE_MS);
            return (
              <li key={a.code}>
                <Link href={`/activity?agent=${a.code}`} title={a.lastSummary ?? `${a.name} has no activity yet`}
                  className="group flex h-9 items-center gap-2.5 rounded-[7px] px-2 hover:bg-panel-2">
                  <AgentAvatar agent={a} size={20} live={live} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[12.5px] text-ink-2 group-hover:text-ink">{a.name}</span>
                    <span className="block truncate text-[10.5px] text-ink-3">{a.title}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ink-3">{ago(a.lastAt, now)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );

  const brand = (
    <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-[8px] px-1.5 py-1 hover:bg-panel-2">
      <BrandMark />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13.5px] font-semibold tracking-[-0.01em]">Marvz Studio</span>
        <span className="block truncate text-[11px] text-ink-3">Squad CRM · AI agency</span>
      </span>
    </Link>
  );

  const roleLabel = demo ? "Demo · read-only" : me.code === "letty" ? "Owner" : me.code === "marvin" ? "Owner · admin" : me.code;
  const footer = (
    <div className="space-y-2 border-t border-line p-2.5">
      <InstallApp />
      <ThemeSwitch />
      <div className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1">
        <span className="flex size-7 items-center justify-center rounded-full text-[12px] font-semibold text-black/80" style={{ background: me.color }}>
          {me.name[0]}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium">{me.name}</div>
          <div className="truncate text-[11px] text-ink-3">{roleLabel}</div>
        </div>
        {!demo && (
          <form action="/auth/signout" method="post">
            <button className="btn-ghost h-7 w-7 px-0" title="Sign out" aria-label="Sign out"><LogOut size={14} /></button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-1 px-2">
          <div className="min-w-0 flex-1">{brand}</div>
          <Link href="/leads/new" className="btn-ghost h-7 w-7 shrink-0 px-0" title="New lead (n)" aria-label="New lead"><Plus size={15} /></Link>
        </div>
        <div className="px-2.5 pb-2">
          <button onClick={() => setPaletteOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-[8px] border border-line bg-panel-2/60 px-2.5 text-[13px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink-2">
            <Search size={14} /> <span className="flex-1 text-left">Search or jump to…</span>
            <span className="kbd">⌘K</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">{nav}</div>
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[292px] flex-col border-r border-line-2 bg-sidebar pt-[env(safe-area-inset-top)] shadow-2xl">
            <div className="flex h-14 items-center justify-between gap-1 px-2">
              <div className="min-w-0 flex-1">{brand}</div>
              <button className="btn-ghost w-11 px-0" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto">{nav}</div>
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar */}
        <header className="glass sticky top-0 z-30 hidden h-12 items-center gap-3 border-b border-line px-4 md:flex md:px-8">
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
            <span className="text-ink-3">Squad</span>
            <ChevronRight size={13} className="text-ink-3" />
            <span className={clsx(crumb ? "text-ink-3" : "font-medium text-ink")}>{current?.label ?? "Overview"}</span>
            {crumb && <><ChevronRight size={13} className="text-ink-3" /><span className="truncate font-medium text-ink">{crumb}</span></>}
          </div>
          <div className="flex-1" />
          <Link href="/team" className="flex h-7 items-center gap-2 rounded-full border border-line bg-panel-2/60 px-2.5 text-[12px] text-ink-2 hover:border-line-2 hover:text-ink">
            <Bot size={13} className="text-accent-2" />
            <span className="hidden lg:inline">Grok squad</span>
            <span className="flex -space-x-1">
              {squad.slice(0, 5).map((a) => <span key={a.code} className="size-2 rounded-full ring-2 ring-bg" style={{ background: a.color }} />)}
            </span>
            <span className={clsx("tabular-nums", onlineCount ? "text-emerald-300" : "text-ink-3")}>{onlineCount} live</span>
          </Link>
          <button onClick={() => setHelpOpen(true)} className="btn-ghost h-7 px-2 text-[12px]" aria-label="Keyboard shortcuts"><span className="kbd">?</span></button>
          <Link href="/leads/new" className="btn h-7 text-[12.5px]"><Plus size={13} /> New lead</Link>
        </header>

        {/* Mobile top bar */}
        <header className="glass sticky top-0 z-30 border-b border-line pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-1 px-2">
            <button className="btn-ghost w-11 px-0" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
            <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="Overview">
              <BrandMark size={26} /><span className="truncate text-[14px] font-semibold tracking-[-0.01em]">{current?.label ?? "Squad CRM"}</span>
            </Link>
            <div className="flex-1" />
            <button className="btn-ghost w-11 px-0" onClick={() => setPaletteOpen(true)} aria-label="Search"><Search size={19} /></button>
            <Link href="/leads/new" className="btn-ghost w-11 px-0 text-accent-2" aria-label="New lead"><Plus size={21} /></Link>
          </div>
        </header>

        {demo && (
          <div className="flex items-center gap-2 border-b border-accent/20 bg-accent/[0.07] px-4 py-1.5 text-[12px] text-accent-2 md:px-8">
            <span className="size-1.5 rounded-full bg-accent-2" /> Demo mode · sample data, read-only.
          </div>
        )}

        <main className="min-w-0 flex-1 pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-10">{children}</main>

        {/* Mobile bottom nav */}
        <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line pb-[env(safe-area-inset-bottom)] md:hidden">
          {[flat[0], flat[1], flat[2], flat[3], flat[5]].map((it) => {
            const on = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined}
                className={clsx("relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium [&_svg]:size-[21px]",
                  on ? "text-ink" : "text-ink-3")}>
                {on && <span className="absolute top-0 h-[2px] w-8 rounded-b bg-accent" />}
                <span className={on ? "text-accent-2" : ""}>{it.icon}</span>
                {it.label.split(" ")[0]}
                {!!it.badge && (
                  <span className="absolute left-1/2 top-1 ml-1.5 min-w-[17px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-semibold leading-[17px] text-white">{it.badge}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} nav={flat} leads={leads} squad={squad} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} nav={flat} />}
    </div>
  );
}

type PaletteItem = { id: string; group: string; label: string; hint: string; href: string; icon: ReactNode; haystack?: string };

function Palette({ onClose, nav, leads, squad }: { onClose: () => void; nav: NavItem[]; leads: LeadIndex[]; squad: SquadMember[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const actions: PaletteItem[] = [
      { id: "new-lead", group: "Actions", label: "Create lead", hint: "n", href: "/leads/new", icon: <Plus size={14} /> },
      { id: "new-deal", group: "Actions", label: "Open deal builder", hint: "b", href: "/deals/new", icon: <Calculator size={14} /> },
    ];
    const pages: PaletteItem[] = nav.map((n) => ({ id: n.href, group: "Go to", label: n.label, hint: n.key ? `g ${n.key}` : "", href: n.href, icon: n.icon }));
    const agents: PaletteItem[] = squad.map((a) => ({
      id: `agent-${a.code}`, group: "Agents", label: `${a.name} activity`, hint: a.title, href: `/activity?agent=${a.code}`, icon: <Bot size={14} />,
      haystack: `${a.name} ${a.title} agent`.toLowerCase(),
    }));
    const leadItems: PaletteItem[] = leads.map((l) => ({
      id: l.id, group: "Leads", label: l.name, hint: `${l.code} · ${l.stage.replace(/_/g, " ")}`, href: `/leads/${l.id}`, icon: <User size={14} />,
      haystack: `${l.name} ${l.code} ${l.city ?? ""}`.toLowerCase(),
    }));
    if (!ql) return [...actions, ...pages.slice(0, 6), ...leadItems.slice(0, 6)];
    return [...actions, ...pages, ...agents, ...leadItems].filter((i) => (i.haystack ?? i.label.toLowerCase()).includes(ql)).slice(0, 14);
  }, [q, nav, leads, squad]);

  const go = useCallback((href: string) => { onClose(); router.push(href); }, [onClose, router]);

  return (
    <div data-modal-open className="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 px-3 pt-[12vh] backdrop-blur-[3px]" onClick={onClose}>
      <div className="float w-full max-w-[620px] animate-fade-up overflow-hidden rounded-[14px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={17} className="text-ink-3" />
          <input autoFocus value={q} placeholder="Search leads, agents, pages, actions…"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && items[sel]) go(items[sel].href);
            }}
            aria-label="Search" className="h-13 flex-1 bg-transparent py-4 text-[15px] outline-none placeholder:text-ink-3" />
          <span className="kbd">esc</span>
        </div>
        <ul className="max-h-[52vh] overflow-y-auto p-1.5">
          {items.length === 0 && <li className="px-3 py-8 text-center text-ink-3">No matches for “{q}”</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="eyebrow px-2.5 pb-1 pt-2.5">{it.group}</div>}
              <button onMouseEnter={() => setSel(i)} onClick={() => go(it.href)}
                className={clsx("flex h-9 w-full items-center gap-3 rounded-[8px] px-2.5 text-left text-[13.5px] transition-colors",
                  i === sel ? "bg-panel-3 text-ink" : "text-ink-2")}>
                <span className={i === sel ? "text-accent-2" : "text-ink-3"}>{it.icon}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <span className="truncate text-[11.5px] text-ink-3">{it.hint}</span>
                {i === sel && <CornerDownLeft size={13} className="text-ink-3" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1"><span className="kbd">↑</span><span className="kbd">↓</span> navigate</span>
          <span className="flex items-center gap-1"><span className="kbd">↵</span> open</span>
          <span className="ml-auto flex items-center gap-1">Shortcuts <span className="kbd">?</span></span>
        </div>
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
    <div data-modal-open className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-3 backdrop-blur-[3px]" onClick={onClose}>
      <div className="float w-full max-w-[460px] animate-fade-up rounded-[14px] p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-[15px] font-semibold">Keyboard shortcuts</div>
          <button className="btn-ghost h-7 w-7 px-0" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 border-b border-line pb-2">
              <div className="truncate text-ink-2">{v}</div>
              <div className="flex shrink-0 gap-1">{k.split(" ").map((p, i) => <span key={i} className="kbd">{p}</span>)}</div>
            </div>
          ))}
        </div>
        <Link href="/team" onClick={onClose} className="mt-4 flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">Agent API reference <ArrowRight size={12} /></Link>
      </div>
    </div>
  );
}

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { stageMeta, type Tone } from "@/lib/constants";
import type { Agent, Stage } from "@/lib/types";

const TONES: Record<Tone, string> = {
  slate: "bg-ink/[0.06] text-ink-2 ring-ink/10",
  blue: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  teal: "bg-teal-400/10 text-teal-300 ring-teal-400/20",
  red: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  accent: "bg-accent/15 text-accent-2 ring-accent/30",
};
const DOTS: Record<Tone, string> = {
  slate: "bg-ink-3", blue: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400",
  green: "bg-emerald-400", teal: "bg-teal-400", red: "bg-rose-400", accent: "bg-accent",
};

export function Chip({ tone = "slate", children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className={clsx("size-1.5 rounded-full", DOTS[tone])} />}
      {children}
    </span>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  const m = stageMeta(stage);
  return <Chip tone={m.tone} dot>{m.label}</Chip>;
}

export function StageDot({ stage }: { stage: Stage }) {
  return <span className={clsx("inline-block size-2 shrink-0 rounded-full", DOTS[stageMeta(stage).tone])} />;
}

const STATUS_TONE: Record<string, Tone> = {
  open: "amber", in_review: "violet", with_letty: "red", resolved: "green", dismissed: "slate",
  pending: "amber", approved: "green", partially_approved: "amber", rejected: "red",
  ready: "blue", in_batch: "amber", sent: "green", draft: "slate",
  quoted: "blue", proposed: "amber", signed: "green", lost: "red",
  planning: "slate", active: "blue", at_risk: "red", delivered: "green", closed: "slate",
  in_progress: "blue", done: "green", slipped: "red", blocked: "red",
  scheduled: "slate", invoiced: "amber", paid: "green", overdue: "red",
  to_request: "slate", requested: "amber", received: "green", published: "teal", declined: "red",
  contacted: "blue", converted: "green", dead: "slate", paused: "amber", cancelled: "red",
  low: "slate", medium: "amber", high: "red", urgent: "red", sent_for_signature: "amber",
};

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={STATUS_TONE[status] ?? "slate"} dot>{status.replace(/_/g, " ")}</Chip>;
}

export function AgentAvatar({ agent, size = 20, withName = false }: { agent?: Pick<Agent, "name" | "color" | "kind"> | null; size?: number; withName?: boolean }) {
  if (!agent) return <span className="text-ink-3">—</span>;
  const initials = agent.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={agent.name}
        className={clsx("inline-flex shrink-0 items-center justify-center font-semibold text-black/80", agent.kind === "human" ? "rounded-full" : "rounded-[5px]")}
        style={{ width: size, height: size, background: agent.color, fontSize: Math.max(9, size * 0.42) }}
      >
        {initials}
      </span>
      {withName && <span className="text-ink-2">{agent.name}</span>}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-3 pt-6 md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-[28px] font-bold leading-tight tracking-[-0.022em] md:text-[32px]">
          {icon}
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[14px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "good"; href?: string }) {
  const body = (
    <div className={clsx("card h-full px-4 py-4", href && "transition-[transform,background-color] duration-200 hover:-translate-y-0.5 hover:bg-panel-2")}>
      <div className="text-[12px] font-medium text-ink-3">{label}</div>
      <div className={clsx("mt-1 text-[26px] font-semibold tracking-[-0.02em] tabular-nums",
        tone === "bad" && "text-rose-300", tone === "warn" && "text-amber-300", tone === "good" && "text-emerald-300")}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="font-medium text-ink-2">{title}</div>
      {children && <div className="max-w-sm text-[12px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "bad" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-3" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={clsx("h-full rounded-full", tone === "accent" && "bg-accent", tone === "warn" && "bg-amber-400", tone === "bad" && "bg-rose-400")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-2 py-1.5">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="min-w-0 break-words text-ink">{children ?? <span className="text-ink-3">—</span>}</div>
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="px-4 pb-1 pt-1 md:px-8">
      <div className="segmented" role="tablist">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} scroll={false} role="tab" aria-selected={t.key === active}
            data-active={t.key === active} className="segment">
            {t.label}
            {t.count != null && <span className="rounded-full bg-ink/[0.08] px-1.5 text-[11px] tabular-nums text-ink-2">{t.count}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

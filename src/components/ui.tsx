import clsx from "clsx";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { stageMeta, type Tone } from "@/lib/constants";
import type { Agent, Stage } from "@/lib/types";

const TONES: Record<Tone, string> = {
  slate: "bg-ink/[0.06] text-ink-2 ring-ink/[0.08]",
  blue: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  violet: "bg-violet-400/10 text-violet-300 ring-violet-400/20",
  amber: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  green: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  teal: "bg-teal-400/10 text-teal-300 ring-teal-400/20",
  red: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
  accent: "bg-accent/12 text-accent-2 ring-accent/25",
};
const DOTS: Record<Tone, string> = {
  slate: "bg-ink-3", blue: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400",
  green: "bg-emerald-400", teal: "bg-teal-400", red: "bg-rose-400", accent: "bg-accent",
};

export function Chip({ tone = "slate", children, dot = false, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-1.5 text-[11.5px] font-medium ring-1 ring-inset", TONES[tone], className)}>
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

export function AgentAvatar({ agent, size = 20, withName = false, live }: {
  agent?: Pick<Agent, "name" | "color" | "kind"> | null; size?: number; withName?: boolean; live?: boolean;
}) {
  if (!agent) return <span className="text-ink-3">—</span>;
  const initials = agent.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const ai = agent.kind === "ai";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-flex shrink-0">
        <span
          title={agent.name}
          className={clsx("inline-flex items-center justify-center font-semibold tracking-tight",
            ai ? "rounded-[28%] text-white" : "rounded-full text-black/80")}
          style={{
            width: size, height: size, fontSize: Math.max(9, size * 0.4),
            background: ai
              ? `linear-gradient(140deg, color-mix(in oklab, ${agent.color} 92%, white), color-mix(in oklab, ${agent.color} 55%, black))`
              : agent.color,
            boxShadow: ai ? `0 0 0 1px color-mix(in oklab, ${agent.color} 40%, transparent) inset` : undefined,
          }}
        >
          {initials}
        </span>
        {live != null && (
          <span className={clsx("absolute -bottom-px -right-px rounded-full ring-2 ring-panel",
            live ? "animate-pulse-dot bg-emerald-400 text-emerald-400" : "bg-ink-3")}
            style={{ width: Math.max(6, size * 0.28), height: Math.max(6, size * 0.28) }} />
        )}
      </span>
      {withName && <span className="text-ink-2">{agent.name}</span>}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, icon, eyebrow }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="hero-bg">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-5 pt-6 md:px-8 md:pt-8">
        <div className="min-w-0 animate-fade-up">
          {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
          <h1 className="flex items-center gap-2.5 text-[22px] font-semibold leading-tight tracking-[-0.025em] md:text-[26px]">
            {icon && <span className="flex size-8 items-center justify-center rounded-[9px] border border-line-2 bg-panel-2 text-ink-2 [&_svg]:size-4">{icon}</span>}
            {title}
          </h1>
          {subtitle && <p className="mt-1.5 max-w-3xl text-[13.5px] text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint, tone, href, icon, spark }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" | "good"; href?: string;
  icon?: ReactNode; spark?: number[];
}) {
  const body = (
    <div className={clsx("card group relative h-full overflow-hidden px-4 py-3.5", href && "transition-colors duration-200 hover:border-line-2")}>
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        {icon && <span className="text-ink-3 [&_svg]:size-3.5">{icon}</span>}
        <span className="truncate">{label}</span>
        {href && <ArrowUpRight size={13} className="ml-auto opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className={clsx("mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.03em] tabular-nums",
        tone === "bad" && "text-rose-300", tone === "warn" && "text-amber-300", tone === "good" && "text-emerald-300")}>{value}</div>
      {hint && <div className="mt-1.5 truncate text-[12px] text-ink-3">{hint}</div>}
      {spark && spark.length > 1 && <Sparkline values={spark} className="absolute bottom-0 right-0 h-10 w-28 opacity-70" />}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** Tiny area chart (no axes) for trend hints. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const w = 100, h = 32;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="var(--color-accent)" fillOpacity="0.14" />
      <path d={line} fill="none" stroke="var(--color-accent-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="flex size-9 items-center justify-center rounded-[10px] border border-line-2 bg-panel-2 text-ink-3">{icon}</div>}
      <div className="font-medium text-ink-2">{title}</div>
      {children && <div className="max-w-sm text-[12px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "bad" }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-3" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className={clsx("h-full rounded-full transition-[width] duration-500",
        tone === "accent" && "bg-gradient-to-r from-accent to-accent-2", tone === "warn" && "bg-amber-400", tone === "bad" && "bg-rose-400")}
        style={{ width: `${pct}%` }} />
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

/** Underline tabs (Linear-style). */
export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="border-b border-line px-4 md:px-8">
      <div className="-mb-px flex max-w-full gap-1 overflow-x-auto" role="tablist">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <Link key={t.key} href={t.href} scroll={false} role="tab" aria-selected={on}
              className={clsx("flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors",
                on ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2")}>
              {t.label}
              {t.count != null && <span className={clsx("rounded-[5px] px-1.5 text-[11px] tabular-nums", on ? "bg-accent/15 text-accent-2" : "bg-ink/[0.07] text-ink-3")}>{t.count}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

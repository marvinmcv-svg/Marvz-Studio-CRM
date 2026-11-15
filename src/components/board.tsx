"use client";

import clsx from "clsx";
import { Camera, Mail, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { canMoveStage, type Tone } from "@/lib/constants";
import type { Channel, Stage } from "@/lib/types";
import { StageMoveDialog } from "./stage-move";
import { AgentAvatar, Chip } from "./ui";

export type BoardCard = {
  id: string; code: string; name: string; city: string | null; market: string | null; industry: string | null;
  budget: string | null; channel: Channel | null; stage: Stage; daysInStage: number; value: string | null;
  owner: { name: string; color: string; kind: "human" | "ai" } | null; nextAction: string | null; flag: string | null;
  flags?: { label: string; tone: Tone }[];
};
export type BoardColumn = { key: Stage; label: string; tone: Tone; cards: BoardCard[]; total: string | null };

const CHANNEL_ICON: Record<Channel, React.ReactNode> = {
  whatsapp: <MessageCircle size={12} />, email: <Mail size={12} />, instagram: <Camera size={12} />,
};
const DOT: Record<Tone, string> = {
  slate: "bg-ink-3", blue: "bg-sky-400", violet: "bg-violet-400", amber: "bg-amber-400", green: "bg-emerald-400",
  teal: "bg-teal-400", red: "bg-rose-400", accent: "bg-accent",
};

export function Board({ columns, readOnly, agent }: { columns: BoardColumn[]; readOnly: boolean; agent: string }) {
  const [drag, setDrag] = useState<BoardCard | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [move, setMove] = useState<{ card: BoardCard; to: Stage } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const check = (to: Stage) => (drag ? canMoveStage(agent, drag.stage, to) : null);

  return (
    <div className="flex h-[calc(100dvh-170px)] min-h-[420px] gap-2.5 overflow-x-auto px-4 py-4 md:px-8">
      {columns.map((col) => (
        <section key={col.key}
          onDragOver={(e) => { if (drag && check(col.key)?.ok) { e.preventDefault(); setOver(col.key); } }}
          onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
          onDrop={() => { if (drag && check(col.key)?.ok) setMove({ card: drag, to: col.key }); setDrag(null); setOver(null); }}
          title={drag && drag.stage !== col.key && !check(col.key)?.ok ? (check(col.key) as { reason: string }).reason : undefined}
          className={clsx("flex w-[272px] shrink-0 flex-col rounded-xl border bg-panel/60 transition-[colors,opacity]",
            over === col.key ? "border-accent/60 bg-accent/[0.04]" : "border-line",
            drag && drag.stage !== col.key && !check(col.key)?.ok && "opacity-40")}>
          <header className="flex items-center gap-2 px-3 py-2.5">
            <span className={clsx("size-2 rounded-full", DOT[col.tone])} />
            <span className="font-medium">{col.label}</span>
            <span className="text-[12px] tabular-nums text-ink-3">{col.cards.length}</span>
            {col.total && <span className="ml-auto text-[11px] tabular-nums text-ink-3">{col.total}</span>}
          </header>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
            {col.cards.length === 0 && (
              <div className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12px] text-ink-3">No leads</div>
            )}
            {col.cards.map((c) => (
              <Link key={c.id} href={`/leads/${c.id}`} draggable={!readOnly}
                onDragStart={(e) => { setDrag(c); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                className={clsx("group block rounded-lg border border-line bg-panel-2 p-2.5 transition-colors hover:border-line-2 hover:bg-panel-3",
                  drag?.id === c.id && "opacity-40")}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="truncate text-[11px] text-ink-3">{c.code} · {c.industry ?? "—"}{c.city && ` · ${c.city}`}</div>
                  </div>
                  <AgentAvatar agent={c.owner} size={18} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {c.market && <Chip>{c.market}</Chip>}
                  {c.budget && c.budget !== "unknown" && <Chip>{c.budget}</Chip>}
                  {c.channel && <Chip className="gap-1">{CHANNEL_ICON[c.channel]}</Chip>}
                  {c.flag && <Chip tone="red" dot>{c.flag}</Chip>}
                  {c.flags?.map((f) => <Chip key={f.label} tone={f.tone} dot>{f.label}</Chip>)}
                  {c.value && <span className="ml-auto text-[12px] font-medium tabular-nums text-ink">{c.value}</span>}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-3">
                  <span className="truncate">{c.nextAction ?? ""}</span>
                  <span className={clsx("shrink-0 tabular-nums", c.daysInStage > 14 && "text-amber-300")}>{c.daysInStage}d</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {move && (
        <StageMoveDialog leadId={move.card.id} leadName={move.card.name} from={move.card.stage} to={move.to}
          onClose={() => setMove(null)} onDone={(ok) => { if (ok) { setToast(`${move.card.name} moved`); setTimeout(() => setToast(null), 2500); } }} />
      )}
      {toast && <div className="fixed bottom-20 left-1/2 z-[80] -translate-x-1/2 rounded-lg border border-line-2 bg-panel-3 px-3 py-2 shadow-xl md:bottom-6">{toast}</div>}
    </div>
  );
}

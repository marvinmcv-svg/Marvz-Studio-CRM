import type { Stage } from "./types";

export const STAGES: { key: Stage; label: string; tone: Tone; owner: string }[] = [
  { key: "held", label: "Held", tone: "amber", owner: "hunter" },
  { key: "found", label: "Found", tone: "slate", owner: "hunter" },
  { key: "screened", label: "Screened", tone: "slate", owner: "jordan" },
  { key: "draft_ready", label: "Draft ready", tone: "blue", owner: "jordan" },
  { key: "approved", label: "Approved", tone: "blue", owner: "letty" },
  { key: "sent", label: "Sent", tone: "blue", owner: "jordan" },
  { key: "replied", label: "Replied", tone: "violet", owner: "jordan" },
  { key: "discovery", label: "Discovery", tone: "violet", owner: "quinn" },
  { key: "proposal", label: "Proposal", tone: "amber", owner: "quinn" },
  { key: "signed", label: "Signed", tone: "green", owner: "quinn" },
  { key: "in_delivery", label: "In delivery", tone: "green", owner: "dana" },
  { key: "delivered", label: "Delivered", tone: "green", owner: "dana" },
  { key: "care_plan", label: "Care plan", tone: "teal", owner: "dana" },
];
export const EXIT_STAGES: { key: Stage; label: string; tone: Tone }[] = [
  { key: "lost", label: "Lost", tone: "red" },
  { key: "do_not_contact", label: "Do not contact", tone: "red" },
];
export const ALL_STAGES = [...STAGES, ...EXIT_STAGES];
export const stageMeta = (s: Stage) => ALL_STAGES.find((x) => x.key === s) ?? { key: s, label: s, tone: "slate" as Tone };

export type Tone = "slate" | "blue" | "violet" | "amber" | "green" | "teal" | "red" | "accent";

export const BUDGET_BANDS = ["<2k", "2-5k", "5-10k", "10-20k", "20k+", "unknown"];
export const CHANNELS = ["whatsapp", "email", "instagram"] as const;

/** Stages each agent may move a lead INTO (mirrors public.allowed_target_stages). */
export const ALLOWED_TARGETS: Record<string, Stage[] | "all"> = {
  letty: "all",
  marvin: "all",
  top_g: "all",
  hunter: ["held", "found", "lost", "do_not_contact"],
  jordan: ["held", "found", "screened", "draft_ready", "sent", "replied", "lost", "do_not_contact"],
  quinn: ["replied", "discovery", "proposal", "signed", "lost", "do_not_contact"],
  dana: ["signed", "in_delivery", "delivered", "care_plan", "lost", "do_not_contact"],
};

/**
 * Stages a lead may come FROM for each target (mirrors public.stage_predecessors,
 * migration 20261114000005). The database is the authority; this only lets the
 * UI hide moves that would be refused. A unit test keeps the two in sync.
 */
export const STAGE_PREDECESSORS: Record<Stage, Stage[]> = {
  held: ["found", "screened"],
  found: ["held"],
  screened: ["found"],
  draft_ready: ["found", "screened"],
  approved: ["found", "screened", "draft_ready"],
  sent: ["approved"],
  replied: ["sent"],
  discovery: ["sent", "replied"],
  proposal: ["replied", "discovery"],
  signed: ["discovery", "proposal"],
  in_delivery: ["signed"],
  delivered: ["in_delivery"],
  care_plan: ["in_delivery", "delivered"],
  lost: ["held", "found", "screened", "draft_ready", "approved", "sent", "replied", "discovery", "proposal"],
  do_not_contact: ["held", "found", "screened", "draft_ready", "approved", "sent", "replied", "discovery", "proposal",
    "signed", "in_delivery", "delivered", "care_plan", "lost"],
};

/** Which function should make this move instead of a manual stage change. */
const VIA_RPC: Partial<Record<Stage, string>> = {
  approved: "Letty approves drafts on the Approvals page",
  sent: "Jordan logs the send with log_send",
  signed: "Quinn signs the deal with sign_deal",
  in_delivery: "Dana starts the project with create_project",
};

/** Can `agent` move a lead from `from` to `to`? Returns the reason when not. */
export function canMoveStage(agent: string, from: Stage, to: Stage): { ok: true } | { ok: false; reason: string } {
  if (from === to) return { ok: false, reason: "Current stage" };
  const targets = ALLOWED_TARGETS[agent];
  if (!targets) return { ok: false, reason: "Not a squad member" };
  if (targets === "all") return { ok: true };
  if (!targets.includes(to)) return { ok: false, reason: "Not your stage" };
  if (!STAGE_PREDECESSORS[to].includes(from)) return { ok: false, reason: `Not from ${stageMeta(from).label}` };
  if (VIA_RPC[to]) return { ok: false, reason: VIA_RPC[to]! };
  return { ok: true };
}

export const OPEN_DEAL_STATUSES = ["draft", "quoted", "proposed"] as const;

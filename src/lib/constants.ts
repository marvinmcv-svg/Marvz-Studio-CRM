import type { Stage } from "./types";

export const STAGES: { key: Stage; label: string; tone: Tone; owner: string }[] = [
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
  top_g: "all",
  hunter: ["found", "lost", "do_not_contact"],
  jordan: ["found", "screened", "draft_ready", "sent", "replied", "lost", "do_not_contact"],
  quinn: ["replied", "discovery", "proposal", "signed", "lost", "do_not_contact"],
  dana: ["signed", "in_delivery", "delivered", "care_plan", "lost", "do_not_contact"],
};

export const OPEN_DEAL_STATUSES = ["draft", "quoted", "proposed"] as const;

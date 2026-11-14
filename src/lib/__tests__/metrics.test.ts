import { describe, expect, it } from "vitest";
import { capacity, dealStats, isSlipping, mrr } from "../metrics";
import type { CareSubscription, Deal, Milestone, Project } from "../types";

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe("metrics", () => {
  it("MRR only bills plans whose included period has ended", () => {
    const subs = [
      { status: "active", monthly_usd: 100, included_until: null },
      { status: "active", monthly_usd: 50, included_until: day(30) },
      { status: "cancelled", monthly_usd: 999, included_until: null },
    ] as unknown as CareSubscription[];
    expect(mrr(subs)).toEqual({ billing: 100, committed: 150 });
  });

  it("deal stats", () => {
    const deals = [
      { status: "signed", one_off_total_usd: 3000 }, { status: "lost", one_off_total_usd: 1000 },
      { status: "quoted", one_off_total_usd: 2000 },
    ] as unknown as Deal[];
    const s = dealStats(deals);
    expect(s.winRate).toBe(0.5);
    expect(s.pipelineValue).toBe(2000);
    expect(s.avgDeal).toBe(3000);
  });

  it("slipping milestones", () => {
    expect(isSlipping({ status: "pending", due_date: day(-1) } as Milestone)).toBe(true);
    expect(isSlipping({ status: "done", due_date: day(-10) } as Milestone)).toBe(false);
    expect(isSlipping({ status: "slipped", due_date: day(5) } as Milestone)).toBe(true);
  });

  it("capacity counts projects in the month", () => {
    const month = day(0).slice(0, 7);
    const projects = [{ slot_month: `${month}-01` }, { slot_month: `${month}-01` }, { slot_month: "2000-01-01" }] as Project[];
    expect(capacity(projects, 4, month)).toEqual({ month, used: 2, limit: 4, remaining: 2 });
  });
});

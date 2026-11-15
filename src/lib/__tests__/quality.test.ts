import { describe, expect, it } from "vitest";
import { isStale, outreachBlockers } from "../quality";
import type { Lead } from "../types";

const base = { id: "a", stage: "screened", on_hold: false, manual_check: "PASS", domain_status: "VERIFIED" } as Lead;

describe("outreachBlockers mirrors the database rules", () => {
  it("a checked, verified, unfrozen lead is ready", () => {
    expect(outreachBlockers(base, new Set())).toEqual([]);
  });
  it("lists every blocker", () => {
    const l = { ...base, stage: "held", on_hold: true, hold_reason: "waiting", manual_check: "PENDING", domain_status: "UNVERIFIED" } as Lead;
    expect(outreachBlockers(l, new Set(["a"]))).toHaveLength(5);
  });
  it("NSC (confirmed no site) is not a blocker", () => {
    expect(outreachBlockers({ ...base, domain_status: "NSC" } as Lead, new Set())).toEqual([]);
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-11-15T00:00:00Z");
  it("never verified is stale; lost leads are not", () => {
    expect(isStale({ stage: "found", last_verified_at: null }, 30, now)).toBe(true);
    expect(isStale({ stage: "lost", last_verified_at: null }, 30, now)).toBe(false);
  });
  it("uses the day window", () => {
    expect(isStale({ stage: "found", last_verified_at: "2026-10-01T00:00:00Z" }, 30, now)).toBe(true);
    expect(isStale({ stage: "found", last_verified_at: "2026-11-01T00:00:00Z" }, 30, now)).toBe(false);
  });
});

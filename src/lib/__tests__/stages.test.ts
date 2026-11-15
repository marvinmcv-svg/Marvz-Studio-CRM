import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_STAGES, ALLOWED_TARGETS, canMoveStage, STAGE_PREDECESSORS } from "../constants";
import type { Stage } from "../types";

const DIR = new URL("../../../supabase/migrations/", import.meta.url);
const sql = (f: string) => readFileSync(new URL(f, DIR), "utf8");
/** Source of the newest migration that (re)defines a function. */
const latest = (fn: string) => {
  const file = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => sql(f).includes(`function public.${fn}(`));
  if (!file) throw new Error(`${fn} not found in migrations`);
  return sql(file);
};

/** Parse `when 'x' then '{a,b}'` rows out of a SQL CASE expression. */
function parseCase(body: string, quoted: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const re = quoted ? /when '(\w+)'\s+then '\{([^}]*)\}'/g : /when '(\w+)'\s+then array\[([^\]]*)\]/g;
  for (const m of body.matchAll(re)) {
    out[m[1]] = m[2].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
  }
  return out;
}

describe("UI stage rules mirror the database", () => {
  it("STAGE_PREDECESSORS matches public.stage_predecessors()", () => {
    const src = latest("stage_predecessors");
    const fn = src.slice(src.indexOf("function public.stage_predecessors"), src.indexOf("end)::pipeline_stage[]"));
    const db = parseCase(fn, true);
    expect(Object.keys(db).sort()).toEqual(ALL_STAGES.map((s) => s.key).sort());
    for (const [to, from] of Object.entries(db)) expect([...STAGE_PREDECESSORS[to as Stage]].sort()).toEqual(from.sort());
  });

  it("ALLOWED_TARGETS matches public.allowed_target_stages()", () => {
    const src = latest("allowed_target_stages");
    const start = src.indexOf("function public.allowed_target_stages");
    const fn = src.slice(start, src.indexOf("$$;", start));
    const db = parseCase(fn, false);
    for (const [agent, targets] of Object.entries(ALLOWED_TARGETS)) {
      if (targets === "all") expect(fn).toMatch(new RegExp(`when '${agent}'\\s+then enum_range`));
      else expect([...targets].sort()).toEqual(db[agent].sort());
    }
  });
});

describe("canMoveStage", () => {
  it("lets admins correct the pipeline, and only Marvin lose a signed client", () => {
    expect(canMoveStage("top_g", "care_plan", "found").ok).toBe(true);
    expect(canMoveStage("marvin", "lost", "discovery").ok).toBe(true);
    expect(canMoveStage("marvin", "signed", "lost").ok).toBe(true);
    expect(canMoveStage("top_g", "signed", "lost").ok).toBe(false);
    expect(canMoveStage("letty", "lost", "discovery").ok).toBe(false);
  });
  it("blocks backwards moves, skipping ahead and losing signed clients", () => {
    expect(canMoveStage("quinn", "in_delivery", "replied").ok).toBe(false);
    expect(canMoveStage("quinn", "screened", "proposal").ok).toBe(false);
    expect(canMoveStage("hunter", "signed", "lost").ok).toBe(false);
    expect(canMoveStage("jordan", "lost", "found").ok).toBe(false);
  });
  it("allows the normal forward moves", () => {
    expect(canMoveStage("quinn", "replied", "discovery").ok).toBe(true);
    expect(canMoveStage("hunter", "found", "lost").ok).toBe(true);
    expect(canMoveStage("dana", "care_plan", "do_not_contact").ok).toBe(true);
  });
  it("points to the right function for moves that need one", () => {
    const r = canMoveStage("quinn", "proposal", "signed");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sign_deal/);
  });
  it("refuses unknown users", () => {
    expect(canMoveStage("", "found", "lost").ok).toBe(false);
  });
});

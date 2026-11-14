import { cache } from "react";
import demo from "./demo/data.json";
import { demoAllowed, isLive, NOT_CONFIGURED } from "./supabase/env";
import { supabaseServer } from "./supabase/server";
import type { AgentCode, TableName, Tables } from "./types";

// ---------------------------------------------------------------------------
// Demo fixtures: exported from a seeded database (scripts/export-demo.sh) and
// time-shifted so "3 days ago" stays 3 days ago whenever you open the app.
// ---------------------------------------------------------------------------
const TS = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}.*)?$/;

const demoTables = cache((): Tables => {
  const shiftMs = Date.now() - new Date((demo as { exported_at: string }).exported_at).getTime();
  const shiftDays = Math.round(shiftMs / 86400000);
  const shift = (v: unknown): unknown => {
    if (typeof v === "string" && TS.test(v)) {
      if (v.length === 10) {
        const d = new Date(v + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + shiftDays);
        return d.toISOString().slice(0, 10);
      }
      return new Date(new Date(v).getTime() + shiftMs).toISOString();
    }
    if (Array.isArray(v)) return v.map(shift);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
    return v;
  };
  const { exported_at: _ignored, ...rest } = demo as Record<string, unknown>;
  void _ignored;
  return shift(rest) as Tables;
});

const ORDER: Partial<Record<TableName, string>> = {
  activity_log: "created_at",
  stage_changes: "created_at",
  leads: "created_at",
  escalations: "created_at",
};

export async function getTables<K extends TableName>(...names: K[]): Promise<Pick<Tables, K>> {
  if (!isLive) {
    if (!demoAllowed()) throw new Error(NOT_CONFIGURED);
    const all = demoTables();
    const out = {} as Pick<Tables, K>;
    for (const n of names) {
      const rows = [...(all[n] as unknown[])] as Tables[K];
      if (ORDER[n]) (rows as { created_at: string }[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
      out[n] = rows;
    }
    return out;
  }
  const sb = await supabaseServer();
  const results = await Promise.all(
    names.map(async (n) => {
      let q = sb.from(n).select("*");
      if (ORDER[n]) q = q.order(ORDER[n]!, { ascending: false });
      q = q.limit(n === "activity_log" ? 1500 : 5000);
      const { data, error } = await q;
      if (error) throw new Error(`Loading ${n}: ${error.message}`);
      return [n, data ?? []] as const;
    }),
  );
  return Object.fromEntries(results) as unknown as Pick<Tables, K>;
}

export type Me = { code: AgentCode; name: string; email: string | null; demo: boolean };

export const getMe = cache(async (): Promise<Me | null> => {
  if (!isLive) {
    if (!demoAllowed()) throw new Error(NOT_CONFIGURED);
    return { code: "letty", name: "Letty", email: null, demo: true };
  }
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("agents").select("code,name").eq("auth_user_id", user.id).maybeSingle();
  if (!data) return null;
  return { code: data.code as AgentCode, name: data.name, email: user.email ?? null, demo: false };
});

/** Lookup helpers */
export function indexBy<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T> {
  return new Map(rows.map((r) => [r[key], r]));
}
export function groupBy<T, K>(rows: T[], fn: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = fn(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

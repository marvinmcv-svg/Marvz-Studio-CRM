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

// Stable sort key for paging through tables that have no natural order.
const KEY: Partial<Record<TableName, string[]>> = {
  agents: ["code"], markets: ["code"], catalogue_packages: ["code"], catalogue_addons: ["code"],
  catalogue_care_plans: ["code"], catalogue_terms: ["key"], catalogue_package_prices: ["package_code", "market_code"],
};

/**
 * Supabase's API returns at most 1,000 rows per request (`max_rows`), so a plain
 * select silently truncates bigger tables. Every table is read in pages until
 * it is complete. activity_log is the exception: pages that list it only need
 * the recent stream, and lead/project pages use getActivity() for full history.
 */
const PAGE = 1000;
const RECENT_ACTIVITY = 2000;
const SAFETY_CAP = 100_000;

async function fetchAll(table: TableName, max = SAFETY_CAP): Promise<unknown[]> {
  const sb = await supabaseServer();
  const rows: unknown[] = [];
  for (let from = 0; from < max; from += PAGE) {
    let q = sb.from(table).select("*");
    if (ORDER[table]) q = q.order(ORDER[table]!, { ascending: false });
    for (const k of KEY[table] ?? ["id"]) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(from, Math.min(from + PAGE, max) - 1);
    if (error) throw new Error(`Loading ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
  if (max === SAFETY_CAP) console.warn(`[squad-crm] ${table} has more than ${SAFETY_CAP} rows; only the first ${SAFETY_CAP} were loaded.`);
  return rows;
}

// One fetch per table per request: the layout and the page share results.
const loadTable = cache((table: TableName) =>
  fetchAll(table, table === "activity_log" ? RECENT_ACTIVITY : SAFETY_CAP));

export async function getTables<K extends TableName>(...names: K[]): Promise<Pick<Tables, K>> {
  if (!isLive) {
    if (!demoAllowed()) throw new Error(NOT_CONFIGURED);
    const all = demoTables();
    const out = {} as Pick<Tables, K>;
    for (const n of names) {
      const rows = [...((all[n] as unknown[] | undefined) ?? [])] as Tables[K];
      if (ORDER[n]) (rows as { created_at: string }[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
      out[n] = rows;
    }
    return out;
  }
  const results = await Promise.all(names.map(async (n) => [n, await loadTable(n)] as const));
  return Object.fromEntries(results) as unknown as Pick<Tables, K>;
}

/** Complete activity / stage history for one lead (not limited to the recent stream). */
export const getLeadHistory = cache(async (leadId: string): Promise<Pick<Tables, "activity_log" | "stage_changes">> => {
  if (!isLive) {
    const t = await getTables("activity_log", "stage_changes");
    return {
      activity_log: t.activity_log.filter((a) => a.lead_id === leadId),
      stage_changes: t.stage_changes.filter((s) => s.lead_id === leadId),
    };
  }
  const sb = await supabaseServer();
  const [a, s] = await Promise.all([
    sb.from("activity_log").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(PAGE),
    sb.from("stage_changes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(PAGE),
  ]);
  if (a.error || s.error) throw new Error(`Loading lead history: ${(a.error ?? s.error)!.message}`);
  return { activity_log: (a.data ?? []) as Tables["activity_log"], stage_changes: (s.data ?? []) as Tables["stage_changes"] };
});

export type Me = { code: AgentCode; name: string; email: string | null; demo: boolean };

export const getMe = cache(async (): Promise<Me | null> => {
  if (!isLive) {
    if (!demoAllowed()) throw new Error(NOT_CONFIGURED);
    return { code: "marvin", name: "Marvin", email: null, demo: true };
  }
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("agents").select("code,name").eq("auth_user_id", user.id).maybeSingle();
  if (!data) return null;
  return { code: data.code as AgentCode, name: data.name, email: user.email ?? null, demo: false };
});

/**
 * "signed_out": no session. "not_linked": signed in to Supabase, but the account
 * is not linked to an active squad member (or the agent was revoked).
 */
export const getAuthState = cache(async (): Promise<"member" | "signed_out" | "not_linked"> => {
  if (!isLive) return "member";
  if (await getMe()) return "member";
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  return user ? "not_linked" : "signed_out";
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

#!/usr/bin/env node
/**
 * Squad CRM — create one Supabase Auth user per squad member, link it to
 * public.agents, and (optionally) mint a long-lived API token per agent for
 * Grokbot.
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   SQUAD_EMAIL_DOMAIN=marvz.studio \
 *   [SUPABASE_JWT_SECRET=...]          # legacy JWT secret → mints 1-year agent tokens
 *   [MARVIN_EMAIL=marvin@yourmail.com] # Marvin's real login email (the sole owner)
 *   node scripts/setup-agents.mjs [--only hunter,jordan] [--days 365]
 *
 * Kill switches (no JWT secret needed):
 *   --revoke hunter     deactivate the agent: every token and session it holds
 *                       stops working immediately (RLS requires agents.active)
 *   --activate hunter   undo --revoke (its old tokens work again unless rotated)
 *   --rotate hunter     delete and recreate the agent's auth user, so every old
 *                       token and password is dead for good; prints new ones
 *
 * Safe to re-run: existing users are reused, passwords are only set for new users.
 * Output goes to stdout ONLY — store it in your password manager / Grokbot secrets.
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const DOMAIN = process.env.SQUAD_EMAIL_DOMAIN ?? "squad.local";
const args = process.argv.slice(2);
const codes = (flag) => {
  if (!args.includes(flag)) return null;
  const v = args[args.indexOf(flag) + 1];
  if (!v || v.startsWith("--")) { console.error(`${flag} needs a comma-separated list of agent codes`); process.exit(1); }
  return v.split(",").map((x) => x.trim()).filter(Boolean);
};
const revoke = codes("--revoke");
const activate = codes("--activate");
const rotate = codes("--rotate");
const only = codes("--only") ?? rotate;
const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 365;

if (!URL_ || !SERVICE) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API).");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

const { data: agents, error } = await admin.from("agents").select("code,name,auth_user_id,active").order("code");
if (error) { console.error("Could not read agents (did you run the migrations?):", error.message); process.exit(1); }

const unknown = [...(revoke ?? []), ...(activate ?? []), ...(rotate ?? [])].filter((c) => !agents.some((a) => a.code === c));
if (unknown.length) { console.error(`Unknown agent code(s): ${unknown.join(", ")}`); process.exit(1); }

if (revoke || activate) {
  if (revoke?.some((c) => c === "marvin")) {
    console.error("Refusing to deactivate the owner (marvin): that could lock you out of the CRM. Do it in the SQL editor if you really mean it.");
    process.exit(1);
  }
  for (const [targets, active] of [[revoke, false], [activate, true]]) {
    if (!targets) continue;
    const { error: e } = await admin.from("agents").update({ active }).in("code", targets);
    if (e) { console.error(`✗ ${e.message}`); process.exit(1); }
    console.error(`✓ ${active ? "re-activated" : "revoked"}: ${targets.join(", ")}`
      + (active ? "" : " (all their tokens and sessions are refused from now on; use --rotate to issue new credentials)"));
  }
  process.exit(0);
}

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const users = list?.users ?? [];
const out = [];

for (const a of agents) {
  if (only && !only.includes(a.code)) continue;
  if (!a.active) { console.error(`· ${a.code}: inactive, skipped (no login is provisioned)`); continue; }
  const email = a.code === "marvin" && process.env.MARVIN_EMAIL ? process.env.MARVIN_EMAIL : `${a.code.replace("_", "-")}@${DOMAIN}`;
  let user = users.find((u) => u.id === a.auth_user_id) ?? users.find((u) => u.email === email);
  if (user && rotate?.includes(a.code)) {
    // A new auth user id means every token signed for the old one no longer matches agents.auth_user_id.
    const { error: e } = await admin.auth.admin.deleteUser(user.id);
    if (e) { console.error(`✗ rotate ${a.code}: ${e.message}`); continue; }
    console.error(`↻ ${a.code}: old auth user deleted; all its tokens and sessions are now invalid`);
    user = undefined;
  }
  let password = null;
  if (!user) {
    password = randomBytes(18).toString("base64url");
    const { data, error: e } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata: { squad_agent: a.code }, user_metadata: { name: a.name },
    });
    if (e) { console.error(`✗ ${a.code}: ${e.message}`); continue; }
    user = data.user;
  }
  if (a.auth_user_id !== user.id) {
    const { error: e } = await admin.from("agents").update({ auth_user_id: user.id }).eq("code", a.code);
    if (e) { console.error(`✗ link ${a.code}: ${e.message}`); continue; }
  }
  const row = { agent: a.code, email, user_id: user.id, password: password ?? "(unchanged)" };
  if (JWT_SECRET && a.code !== "marvin") {
    const now = Math.floor(Date.now() / 1000);
    row.api_token = signJwt({
      aud: "authenticated", role: "authenticated", sub: user.id, email,
      app_metadata: { squad_agent: a.code }, iat: now, exp: now + days * 86400, iss: "squad-crm",
    }, JWT_SECRET);
  }
  out.push(row);
}

console.log(JSON.stringify(out, null, 2));
console.error(`\n✓ ${out.length} squad member(s) ready.` + (JWT_SECRET ? ` Tokens expire in ${days} days.` : " (No SUPABASE_JWT_SECRET → no long-lived tokens; agents sign in with email + password.)"));

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
 *   [LETTY_EMAIL=letty@yourmail.com]   # Letty's real login email
 *   node scripts/setup-agents.mjs [--only hunter,jordan] [--days 365]
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
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
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

const { data: agents, error } = await admin.from("agents").select("code,name,auth_user_id").order("code");
if (error) { console.error("Could not read agents (did you run the migrations?):", error.message); process.exit(1); }

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const users = list?.users ?? [];
const out = [];

for (const a of agents) {
  if (only && !only.includes(a.code)) continue;
  const email = a.code === "letty" && process.env.LETTY_EMAIL ? process.env.LETTY_EMAIL : `${a.code.replace("_", "-")}@${DOMAIN}`;
  let user = users.find((u) => u.id === a.auth_user_id) ?? users.find((u) => u.email === email);
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
  if (JWT_SECRET && a.code !== "letty") {
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

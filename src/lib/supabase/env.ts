export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Demo mode = no Supabase configured: the app renders bundled sample data read-only. */
export const isLive = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/**
 * Demo mode has no sign-in, so a production deploy that is missing its Supabase
 * settings must not quietly turn into a public site. Production builds refuse to
 * serve demo mode unless SQUAD_ALLOW_DEMO=1 is set on purpose (e.g. a public demo).
 */
export function demoAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.SQUAD_ALLOW_DEMO === "1";
}
export const NOT_CONFIGURED =
  "Squad CRM is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
  "(or SQUAD_ALLOW_DEMO=1 to serve the read-only demo on purpose).";

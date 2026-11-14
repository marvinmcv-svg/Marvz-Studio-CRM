export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Demo mode = no Supabase configured: the app renders bundled sample data read-only. */
export const isLive = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

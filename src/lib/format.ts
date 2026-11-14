export function money(amount: number | null | undefined, currency = "USD", opts: { compact?: boolean } = {}) {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: opts.compact && Math.abs(n) >= 10000 ? 1 : 0,
    notation: opts.compact && Math.abs(n) >= 10000 ? "compact" : "standard",
  }).format(n);
}

export const usd = (n: number | null | undefined, compact = false) => money(n, "USD", { compact });

export function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

export function relTime(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return rtf.format(Math.round(diff / (86400 * 30)), "month");
}

export function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function monthLabel(iso: string) {
  return new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export const leadCode = (ref: number) => `SQ-${ref}`;

export function titleCase(s: string | null | undefined) {
  if (!s) return "";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function daysBetween(a: string | Date, b: string | Date = new Date()) {
  const da = typeof a === "string" ? new Date(a.length === 10 ? a + "T12:00:00" : a) : a;
  const db = typeof b === "string" ? new Date(b.length === 10 ? b + "T12:00:00" : b) : b;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

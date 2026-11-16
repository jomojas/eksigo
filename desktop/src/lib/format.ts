// How times, dates and sizes are written across the app.

import { locale, t, tn } from "./i18n";

/** 26:40, or 1:02:03 for an hour or more. */
export function clock(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "10 Nov", or "10 Nov 2024" for another year. */
export function shortDate(unix: number | null | undefined): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Time practised: "12 min", "3 h 20". */
export function practised(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.floor(m / 60);
  return m % 60 ? t("{h} h {m}", { h, m: String(m % 60).padStart(2, "0") }) : t("{n} h", { n: h });
}

/** "Today", "Yesterday", then the date. */
export function whenDay(unix: number | null | undefined): string {
  if (!unix) return "—";
  const d = new Date(unix * 1000);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("Today");
  if (days === 1) return t("Yesterday");
  return shortDate(unix);
}

/** 22 MB, 1.2 GB. */
export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  if (n < 1e9) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

/** "1 word", "3 words", in the language in use (the table has "{n} word" and "{n} words"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return tn(n, `{n} ${one}`, `{n} ${many}`);
}

/** How long until something comes back: "10 min", "1 day", "3 days", "2 mo", "1 yr". */
export function interval(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("{n} h", { n: h });
  const d = Math.round(h / 24);
  if (d < 31) return tn(d, "{n} day", "{n} days");
  const mo = Math.round(d / 30);
  if (mo < 12) return t("{n} mo", { n: mo });
  return t("{n} yr", { n: Math.round(d / 365) });
}

/** When a word next comes up: "Now", "Today", "Tomorrow", "In 5 days", then the date. */
export function nextPractice(dueAt: number | null): string {
  if (dueAt == null) return t("New");
  const now = Date.now() / 1000;
  if (dueAt <= now) return t("Now");
  const days = Math.round((new Date(new Date(dueAt * 1000).toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return t("Today");
  if (days === 1) return t("Tomorrow");
  if (days < 14) return t("In {n} days", { n: days });
  return shortDate(dueAt);
}

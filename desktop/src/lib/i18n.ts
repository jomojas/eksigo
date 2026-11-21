// The language the app is shown in (Settings › General): the computer's own, or one the learner picks.
// English is the source; other languages are tables keyed by the English text, so a text with no entry
// (a show's name, a word) comes back as it is.

import { useEffect, useState } from "react";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { zh } from "./zh";

/** The languages the screens are in, the same six as the iPhone app. */
type Language = "en" | "zh" | "ja" | "ko" | "fr" | "es";
export type UiLanguage = "system" | Language;

/** Each language in its own words, so a learner who can't read the current one still finds theirs. */
export const UI_LANGUAGES: [UiLanguage, string][] = [
  ["system", "Same as the computer"],
  ["en", "English"],
  ["zh", "简体中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["es", "Español"],
];

const KEY = "eksigo.uiLanguage";
const TABLES: Record<string, Record<string, string>> = { zh, ja, ko, fr, es };
/** For dates, numbers and the page's `lang`. */
const LOCALES: Record<Language, string> = { en: "en-GB", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", fr: "fr-FR", es: "es-ES" };
const isLanguage = (v: string | null): v is Language => !!v && v in LOCALES;

function stored(): UiLanguage {
  try {
    const v = localStorage.getItem(KEY);
    return isLanguage(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** "system": the computer's first language Eksigo has, else English. */
function resolve(l: UiLanguage): Language {
  if (l !== "system") return l;
  const langs = typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of langs) {
    const code = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(code)) return code;
  }
  return "en";
}

let chosen = stored();
let current = resolve(chosen);
const subscribers = new Set<() => void>();

/** The language in use. */
export function uiLanguage(): Language {
  return current;
}

/** For dates and numbers. */
export function locale(): string {
  return LOCALES[current];
}

/** The text in the language in use, with `{name}` filled in from `vars`. */
export function t(english: string, vars?: Record<string, string | number>): string {
  const text = TABLES[current]?.[english] ?? english;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

/** "1 word" / "3 words": English needs both; `{n}` is the count. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...vars });
}

/** The setting, and a way to change it; every page is drawn again in the new language. */
export function useUiLanguage(): [UiLanguage, (l: UiLanguage) => void] {
  const [value, setValue] = useState(chosen);
  useEffect(() => {
    const f = () => setValue(chosen);
    subscribers.add(f);
    return () => {
      subscribers.delete(f);
    };
  }, []);
  return [value, setUiLanguage];
}

export function setUiLanguage(l: UiLanguage) {
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* lasts for this visit only */
  }
  chosen = l;
  current = resolve(l);
  document.documentElement.lang = LOCALES[current];
  subscribers.forEach((f) => f());
}

/** Changes when the language does: the app's root uses it as a key, so everything is drawn again. */
export function useLanguageKey(): string {
  useUiLanguage();
  return current;
}

if (typeof document !== "undefined") document.documentElement.lang = LOCALES[current];

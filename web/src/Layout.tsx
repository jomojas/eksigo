import { LANGS, type Lang, type Strings } from "./i18n";

export const GITHUB = "https://github.com/jomojas/eksigo";

/** The Eksigo mark (brand/mark.svg): a line of text, a word, and the dashed box of a missed word. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="mark" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" rx="22.5" fill="#fff" />
      <rect x="22" y="31" width="56" height="10" rx="5" fill="#0b0b0d" />
      <rect x="22" y="56" width="20" height="10" rx="5" fill="#0b0b0d" />
      <rect x="49.5" y="53.5" width="28" height="15" rx="6" fill="none" stroke="#0b0b0d" strokeWidth="6" strokeLinecap="round" strokeDasharray="6.49 12.434" strokeDashoffset="-4.755" />
    </svg>
  );
}
/** The header on every page: the name, the language menu and Download. */
export function Header({ lang, t, setLang }: { lang: Lang; t: Strings; setLang: (l: Lang) => void }) {
  return (
    <header className="top">
      <div className="wrap top-in">
        <a className="logo" href="/"><Mark />Eksigo</a>
        <span className="grow" />
        <label className="lang">
          <span className="sr">{t.language}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3C9.5 5.6 8.2 8.6 8.2 12s1.3 6.4 3.8 9" /></svg>
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {LANGS.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

export function Footer({ t }: { t: Strings }) {
  return (
    <footer className="foot wrap">
      <a className="logo" href="/"><Mark />Eksigo</a>
      <span className="grow" />
      <a href={GITHUB}>GitHub</a>
      <a href="/privacy.html">{t.privacy}</a>
      <a href="/terms.html">{t.terms}</a>
      <a href="/support.html">{t.contact}</a>
    </footer>
  );
}

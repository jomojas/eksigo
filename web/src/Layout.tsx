import { LANGS, type Lang, type Strings } from "./i18n";

export const GITHUB = "https://github.com/jomojas/eksigo";

/** The header on every page: the name, the language menu and Download. */
export function Header({ lang, t, setLang }: { lang: Lang; t: Strings; setLang: (l: Lang) => void }) {
  return (
    <header className="top">
      <div className="wrap top-in">
        <a className="logo" href="/">Eksigo</a>
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
      <a className="logo" href="/">Eksigo</a>
      <span className="grow" />
      <a href={GITHUB}>GitHub</a>
      <a href="/privacy.html">{t.privacy}</a>
      <a href="/terms.html">{t.terms}</a>
      <a href="/support.html">{t.contact}</a>
    </footer>
  );
}

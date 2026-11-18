import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useLang } from "./i18n";
import { Footer, Header } from "./Layout";
import { DOCS, type DocName } from "./docs";
import "./styles.css";

/** `[text](url)` and e-mail addresses as links; everything else as it is. */
function rich(text: string): ReactNode[] {
  return text.split(/(\[[^\]]+\]\([^)]+\)|[\w.+-]+@[\w-]+\.[\w.]+[\w])/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a key={i} href={link[2]}>{link[1]}</a>;
    if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(part)) return <a key={i} href={`mailto:${part}`}>{part}</a>;
    return part;
  });
}

function DocPage({ name }: { name: DocName }) {
  const [lang, t, setLang] = useLang();
  const doc = DOCS[name][lang === "zh" ? "zh" : "en"];
  document.title = `${doc.title} · Eksigo`;
  return (
    <>
      <Header lang={lang} t={t} setLang={setLang} />
      <main className="doc wrap">
        <h1>{doc.title}</h1>
        {doc.updated && <p className="doc-updated">{doc.updated}</p>}
        <p className="doc-intro">{rich(doc.intro)}</p>
        {doc.sections.map((sec) => (
          <section key={sec.h}>
            <h2>{sec.h}</h2>
            {sec.p.map((p, i) =>
              typeof p === "string" ? (
                <p key={i}>{rich(p)}</p>
              ) : (
                <ul key={i}>{p.map((li) => <li key={li}>{rich(li)}</li>)}</ul>
              ),
            )}
          </section>
        ))}
      </main>
      <Footer t={t} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DocPage name={document.body.dataset.page as DocName} />
  </StrictMode>,
);

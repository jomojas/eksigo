import { useState } from "react";
import { useLang } from "./i18n";
import { Footer, Header } from "./Layout";
import { Story } from "./Film";

// Each release also carries the installers under fixed names (release.yml), so these always give the newest.
const LATEST = "https://github.com/jomojas/eksigo/releases/latest/download/";
const MAC = LATEST + "Eksigo-mac.dmg";
const WIN = LATEST + "Eksigo-windows.exe";

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export function App() {
  const [lang, t, setLang] = useLang();
  const [paused, setPaused] = useState(false);

  const mac = <Download key="mac" href={MAC} os="mac" primary={!isWindows} label={t.mac} />;
  const win = <Download key="win" href={WIN} os="win" primary={isWindows} label={t.win} />;
  const buttons = isWindows ? [win, mac] : [mac, win];
  const motion = (
    <button type="button" className="motion" onClick={() => setPaused(!paused)} aria-label={paused ? t.play : t.pause}>
      {paused ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" /></svg>
      )}
    </button>
  );

  return (
    <>
      <Header lang={lang} t={t} setLang={setLang} />

      <main>
        <section className="hero wrap">
          <div className="glow" aria-hidden="true" />
          <h1 className="rise">{t.title}</h1>
          <p className="sub rise" style={{ animationDelay: "120ms" }}>{t.sub}</p>
          <div className="buttons rise" style={{ animationDelay: "240ms" }}>{buttons}</div>
          <p className="meta rise" style={{ animationDelay: "360ms" }}>{t.meta}</p>
        </section>

        <Story t={t} captions={[t.c1, t.c2, t.c3, t.c4, t.c5, t.c6]} paused={paused} control={motion} />

        <section className="info wrap" aria-labelledby="how">
          <h2 id="how" className="info-h">{t.howTitle}</h2>
          <ol className="steps">
            {[[t.h1t, t.h1p], [t.h2t, t.h2p], [t.h3t, t.h3p]].map(([title, text], i) => (
              <li key={i}>
                <span className="step-n">{i + 1}</span>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="info wrap" aria-labelledby="modes">
          <h2 id="modes" className="info-h">{t.modesTitle}</h2>
          <div className="modes">
            {[[t.dicT, t.dicP, t.dicBest, "M4 7h16M4 12h10M4 17h7M17 15l2 2 4-4"], [t.lisT, t.lisP, t.lisBest, "M3 13v-1a9 9 0 0118 0v1M3 13h3v6H4a1 1 0 01-1-1zM21 13h-3v6h2a1 1 0 001-1z"]].map(([title, text, best, icon]) => (
              <article key={title} className="mode">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
                <h3>{title}</h3>
                <p>{text}</p>
                <p className="best">{best}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="info wrap" aria-labelledby="faq">
          <h2 id="faq" className="info-h">{t.faqTitle}</h2>
          <div className="faq">
            {[[t.q1, t.a1], [t.q2, t.a2], [t.q3, t.a3], [t.q4, t.a4], [t.q5, t.a5]].map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="download" className="cta wrap">
          <h2>{t.start}</h2>
          <div className="buttons">{buttons}</div>
          <p className="meta"><span className="soon">{t.iphone}</span></p>
          <p className="note">{t.winNote}</p>
        </section>
      </main>

      <Footer t={t} />
    </>
  );
}

function Download({ href, os, primary, label }: { href: string; os: "mac" | "win"; primary: boolean; label: string }) {
  return (
    <a className={primary ? "btn btn-primary" : "btn"} href={href}>
      {os === "mac" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.8-4.2zM14 5.2c.7-.8 1.2-2 1-3.2-1 0-2.3.7-3 1.5-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.4z" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 5.5l7.4-1v7.1H3zM11.3 4.4L21 3v8.6h-9.7zM3 12.4h7.4v7.1L3 18.5zM11.3 12.4H21V21l-9.7-1.4z" /></svg>
      )}
      {label}
    </a>
  );
}

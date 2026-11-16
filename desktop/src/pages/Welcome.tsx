import { useEffect, useRef, useState, type ReactNode } from "react";
import { backend, type ModelInfo } from "../lib/backend";
import { bytes } from "../lib/format";
import { MEANING_LANGUAGES, useMeaningLanguage } from "../lib/words";
import { Kbd } from "../components/Shell";
import { t } from "../lib/i18n";

// First launch (design D13, DESIGN.md "First launch"): the learner's language, then the speech model, which
// downloads in the background while they carry on. Shown once; the AI step waits until there's AI to set up.

export const WELCOMED = "welcomed";

const STEPS = ["Language", "Speech model"];

export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [lang, setLang] = useMeaningLanguage();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  useEffect(() => {
    backend.models().then(setModels);
  }, []);
  const fast = models?.find((m) => m.available);

  const next = () => {
    if (step < STEPS.length - 1) return setStep(step + 1);
    backend.setSetting(WELCOMED, "1");
    // Not awaited: the download carries on in the status bar. If it fails, the first transcription tries again.
    if (fast && !fast.installed) backend.downloadModel().catch(() => {});
    onDone();
  };

  // Enter continues; the arrow keys move between the languages.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      next();
    } else if (step === 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const i = MEANING_LANGUAGES.findIndex(([c]) => c === lang);
      const n = MEANING_LANGUAGES.length;
      setLang(MEANING_LANGUAGES[(i + (e.key === "ArrowDown" ? 1 : n - 1)) % n][0]);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const last = step === STEPS.length - 1;
  return (
    <div className="welcome">
      <div className="welcome-bar" data-tauri-drag-region />
      <div className="welcome-body" data-tauri-drag-region>
        <div className="welcome-card">
          <div className="welcome-steps">
            <span className="mono">
              {step + 1} / {STEPS.length}
            </span>
            <span className="welcome-dashes" aria-hidden="true">
              {STEPS.map((s, i) => (
                <span key={s} data-state={i < step ? "done" : i === step ? "on" : undefined} />
              ))}
            </span>
            <span>
              {STEPS.map((s, i) => (
                <span key={s}>
                  {i > 0 && " · "}
                  {i === step ? <b>{t(s)}</b> : t(s)}
                </span>
              ))}
            </span>
          </div>

          {step === 0 ? (
            <>
              <Heading title={t("Which language do you speak?")}>
                {t("Word meanings are shown in it, beside the English definition. Eksigo itself is in English for now. You can change this later in Settings.")}
              </Heading>
              <div className="welcome-options welcome-langs" role="radiogroup" aria-label={t("Your language")}>
                {MEANING_LANGUAGES.map(([code, name]) => (
                  <Option key={code} on={lang === code} onPick={() => setLang(code)} title={name} />
                ))}
              </div>
            </>
          ) : (
            <>
              <Heading title={t("The speech model")}>
                {t("It turns episodes into sentences. It runs on this computer, so your audio never leaves it. After it, Eksigo also downloads its phrase translator (about 1.1 GB), for phrases the dictionary doesn't have.")}
              </Heading>
              <div className="welcome-options" role="radiogroup" aria-label={t("Speech model")}>
                <Option on title={t("Fast")} size={fast ? bytes(fast.bytes) : "150 MB"} onPick={() => {}}>
                  {t("Good on most computers. Transcribes faster than you can dictate.")}
                  {fast?.installed && " " + t("Already on this computer.")}
                </Option>
                <Option on={false} title={t("Accurate")} later>
                  {t("Better with strong accents and noisy audio. Arrives after this first version.")}
                </Option>
              </div>
            </>
          )}

          <div className="welcome-actions">
            {step > 0 && (
              <button type="button" className="btn btn-ghost" style={{ marginLeft: -12 }} onClick={() => setStep(step - 1)}>
                {t("Back")}
              </button>
            )}
            <span style={{ flexGrow: 1 }} />
            {last && fast && !fast.installed && <span className="muted welcome-hint">{t("Downloads in the background")}</span>}
            <button type="button" className="btn btn-primary" onClick={next}>
              {t(last && fast && !fast.installed ? "Download and start" : last ? "Start" : "Continue")} <Kbd keys="Enter" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="welcome-title">{title}</h1>
      <p className="welcome-text">{children}</p>
    </div>
  );
}

function Option({ on, title, size, later, onPick, children }: { on: boolean; title: string; size?: string; later?: boolean; onPick?: () => void; children?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-disabled={later} className="welcome-option" data-on={on || undefined} disabled={later} onClick={onPick}>
      <span className="welcome-radio" aria-hidden="true" />
      <span style={{ flexGrow: 1, minWidth: 0 }}>
        <span className="welcome-option-title">
          {title}
          {size && <span className="mono muted">{size}</span>}
          {later && <span className="badge badge-next">{t("Later")}</span>}
        </span>
        {children && <span className="welcome-option-text">{children}</span>}
      </span>
    </button>
  );
}

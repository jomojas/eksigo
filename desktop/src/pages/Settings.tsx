import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { backend, on, type ModelInfo } from "../lib/backend";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Page, useAppInfo } from "../components/Shell";
import { bytes } from "../lib/format";
import { useActivity } from "../lib/transcripts";

const SECTIONS = ["General", "Speech", "About"] as const;
type Section = (typeof SECTIONS)[number];

export function Settings() {
  const [section, setSection] = useState<Section>("General");
  const navigate = useNavigate();

  // Esc leaves Settings for the previous screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  return (
    <Page crumbs={["Settings", section]} keys={[["Esc", "Back"]]}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <nav aria-label="Settings sections" style={{ width: 200, flexShrink: 0, padding: "20px 8px", borderRight: "1px solid var(--hairline)" }}>
          {SECTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === section ? "nav active" : "nav"}
              style={{ width: "100%", border: 0, background: s === section ? undefined : "transparent", cursor: "pointer" }}
              onClick={() => setSection(s)}
            >
              {s}
            </button>
          ))}
        </nav>
        <div className="page" style={{ flexGrow: 1, minWidth: 0 }}>
          {section === "General" && <General />}
          {section === "Speech" && <Speech />}
          {section === "About" && <About />}
        </div>
      </div>
    </Page>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, padding: "14px 0", borderBottom: "1px solid var(--hairline)" }}>
      <div style={{ flexGrow: 1 }}>
        <div style={{ color: "var(--ink)", fontWeight: 500 }}>{label}</div>
        {hint && <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function General() {
  const { choice, setChoice } = useTheme();
  const options: [ThemeChoice, string][] = [
    ["system", "System"],
    ["light", "Light"],
    ["dark", "Dark"],
  ];
  return (
    <section aria-labelledby="general">
      <h1 id="general" className="h1">General</h1>
      <div style={{ marginTop: 16 }}>
        <Row label="Theme" hint="System follows your computer's light or dark setting.">
          <div className="seg" role="group" aria-label="Theme">
            {options.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </div>
    </section>
  );
}

/** The speech model: Whisper runs on this computer with a model downloaded once. */
function Speech() {
  const info = useAppInfo();
  const { model: progress } = useActivity();
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(() => {
    backend.models().then(setModels);
  }, []);
  useEffect(load, [load]);
  useEffect(() => on("model-download", (p) => p.state !== "downloading" && load()), [load]);

  const download = async () => {
    setError(null);
    try {
      await backend.downloadModel();
    } catch (e) {
      setError(String(e));
    }
    load();
  };

  return (
    <section aria-labelledby="speech">
      <h1 id="speech" className="h1">Speech</h1>
      <p className="muted" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>
        Episodes are transcribed on this computer with Whisper ({info?.whisperBackend === "Metal" ? "on the graphics chip" : "on the processor"}).
        The audio never leaves it. The model is downloaded once, the first time you transcribe.
      </p>
      <div style={{ marginTop: 16 }}>
        {models?.map((m) => (
          <Row
            key={m.id}
            label={m.name}
            hint={
              m.available
                ? `English · ${bytes(m.bytes)} · ${m.id === "base.en" ? "quick on any computer, good for clear speech" : ""}`
                : "Better with fast or unclear speech · arrives after v0.1"
            }
          >
            {!m.available ? (
              <span className="badge badge-next">Later</span>
            ) : progress && progress.id === m.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="track" style={{ width: 120 }}>
                  <span className="fill" style={{ display: "block", width: `${Math.round((progress.received / progress.total) * 100)}%` }} />
                </span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {Math.round((progress.received / progress.total) * 100)}%
                </span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => backend.cancelModel()}>
                  Cancel
                </button>
              </div>
            ) : m.installed ? (
              confirm ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12 }}>Transcripts you have stay.</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      await backend.deleteModel(m.id);
                      setConfirm(false);
                      load();
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(false)}>
                    Keep
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="dot dot-ok" />
                    Downloaded
                  </span>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(true)}>
                    Delete
                  </button>
                </div>
              )
            ) : (
              <button type="button" className="btn" onClick={download}>
                Download
              </button>
            )}
          </Row>
        ))}
      </div>
      {error && (
        <p role="alert" style={{ marginTop: 16, color: "var(--semantic-error)" }}>
          {error}
        </p>
      )}
      {models?.[0] && (
        <p className="muted" style={{ marginTop: 16, fontSize: 12 }}>
          Kept in <span className="mono selectable">{models[0].path.replace(/[\\/][^\\/]+$/, "")}</span>
        </p>
      )}
    </section>
  );
}

function About() {
  const info = useAppInfo();
  return (
    <section aria-labelledby="about">
      <h1 id="about" className="h1">About</h1>
      <div className="panel" style={{ marginTop: 16, padding: "8px 16px" }}>
        <div className="prop">Version<b className="mono">{info?.version}</b></div>
        <div className="prop">System<b className="mono">{info?.os}</b></div>
        <div className="prop">Speech engine<b className="mono">{info?.whisperBackend}</b></div>
        <div className="prop">Database schema<b className="mono">{info?.schemaVersion}</b></div>
        <div className="prop">
          Data folder
          <b className="mono selectable ell" style={{ maxWidth: 380, fontSize: 12 }} title={info?.dataDir}>
            {info?.dataDir}
          </b>
        </div>
      </div>
    </section>
  );
}

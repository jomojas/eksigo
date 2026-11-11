import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { backend, inApp, type BenchReport } from "../lib/backend";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Icon } from "../components/Icon";
import { Page, useAppInfo } from "../components/Shell";
import { SPEEDS, usePlayer } from "../lib/playback";

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
        <div className="page" style={{ maxWidth: 680 }}>
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

/** Day 1 check that whisper.cpp works on this computer, and how fast. */
function Speech() {
  const info = useAppInfo();
  const [model, setModel] = useState<string | null>(null);
  const [audio, setAudio] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BenchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState<number | null>(null);
  const player = usePlayer(audio);

  useEffect(() => {
    if (!player.playing) setPlaying(null);
  }, [player.playing]);

  const run = async () => {
    if (!model || !audio) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      setReport(await backend.whisperBench(model, audio));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setRunning(false);
    }
  };

  const name = (p: string | null) => (p ? p.split(/[\\/]/).pop() : "None chosen");

  return (
    <section aria-labelledby="speech">
      <h1 id="speech" className="h1">Speech</h1>
      <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
        Transcription runs on this computer with Whisper ({info?.whisperBackend ?? "…"}). The model download arrives on day 3; for
        now, test with a model file you already have.
      </p>
      <div style={{ marginTop: 16 }}>
        <Row label="Model" hint={name(model)}>
          <button className="btn" disabled={!inApp} onClick={async () => setModel((await backend.pickFile("Whisper model", ["bin"])) ?? model)}>
            Choose…
          </button>
        </Row>
        <Row label="Audio" hint={name(audio)}>
          <button
            className="btn"
            disabled={!inApp}
            onClick={async () => setAudio((await backend.pickFile("Audio or video", ["mp3", "m4a", "mp4", "aac", "wav", "flac", "ogg"])) ?? audio)}
          >
            Choose…
          </button>
        </Row>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        <button className="btn btn-primary" disabled={!model || !audio || running} onClick={run}>
          {running ? "Transcribing…" : "Test transcription"}
        </button>
        {!inApp && <span className="muted">Only in the app, not in the browser preview.</span>}
      </div>

      {error && (
        <p role="alert" style={{ marginTop: 16, color: "var(--semantic-error)" }}>
          {error}
        </p>
      )}

      {report && (
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="panel" style={{ padding: "8px 16px" }}>
            <div className="prop">Speed<b className="mono">{report.speed.toFixed(1)}× real time</b></div>
            <div className="prop">Audio<b className="mono">{report.audioSeconds.toFixed(1)} s</b></div>
            <div className="prop">Transcribing<b className="mono">{(report.transcribeMs / 1000).toFixed(1)} s</b></div>
            <div className="prop">Decoding · loading the model<b className="mono">{report.decodeMs} ms · {report.loadModelMs} ms</b></div>
            <div className="prop">Engine<b className="mono">{report.backend} · {report.threads} threads</b></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <p className="muted" style={{ flexGrow: 1 }}>Play a line to hear exactly that stretch of the audio.</p>
            <div className="seg" role="group" aria-label="Speed">
              {SPEEDS.map((v) => (
                <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>
                  {v === 1 ? "1.0" : v}×
                </button>
              ))}
            </div>
          </div>
          <div className="panel selectable" style={{ padding: "8px 8px 8px 4px", maxHeight: 360, overflowY: "auto", lineHeight: 1.6 }}>
            {report.segments.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ width: 28, padding: 0, flexShrink: 0 }}
                  aria-label={playing === i ? "Stop" : `Play line ${i + 1}`}
                  onClick={() => {
                    if (playing === i) player.stop();
                    else {
                      setPlaying(i);
                      player.play(s.startMs, s.endMs, speed);
                    }
                  }}
                >
                  <Icon name={playing === i ? "pause" : "play"} size={11} stroke={playing === i ? 2.4 : 1.6} />
                </button>
                <span className="mono muted" style={{ fontSize: 11, width: 44, flexShrink: 0, paddingTop: 6 }}>
                  {(s.startMs / 1000).toFixed(1)}s
                </span>
                <span style={{ color: playing === i ? "var(--ink)" : "var(--ink-muted)", paddingTop: 3 }}>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
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

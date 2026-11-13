import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { AUDIO_EXTENSIONS, backend, on, type Added, type AppInfo } from "../lib/backend";
import { fraction, useDownloads } from "../lib/downloads";
import { isBusy, transcribed, useActivity } from "../lib/transcripts";
import { dictationPath, progressLabel, useInProgress } from "../lib/dictation";
import { isMac, keyLabel, modKey } from "../lib/platform";
import { Icon, type IconName } from "./Icon";
import { restartToUpdate, useUpdate } from "../lib/updates";
import { Welcome, WELCOMED } from "../pages/Welcome";
import { displayName, useAccount } from "../lib/account";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/today", label: "Today", icon: "today" },
  { to: "/podcasts", label: "Podcasts", icon: "podcasts" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/words", label: "My words", icon: "words" },
  { to: "/progress", label: "Progress", icon: "progress" },
];

type Keys = [keys: string, label: string][];

const ShellContext = createContext<{
  info: AppInfo | null;
  setKeys: (k: Keys) => void;
  setStatus: (s: string) => void;
  /** Focus mode (Mod \ in Dictation): the sidebar and side panels are hidden. */
  focus: boolean;
  setFocus: (on: boolean) => void;
}>({
  info: null,
  setKeys: () => {},
  setStatus: () => {},
  focus: false,
  setFocus: () => {},
});

export const useFocusMode = (): [boolean, (on: boolean) => void] => {
  const { focus, setFocus } = useContext(ShellContext);
  return [focus, setFocus];
};

/** Opens the file picker and adds the chosen audio or video files to the Library. Null when cancelled. */
export async function addAudio(): Promise<Added | null> {
  const paths = await backend.pickFiles("Add audio or video", AUDIO_EXTENSIONS, true);
  return paths.length ? backend.addFiles(paths) : null;
}

export const useAppInfo = () => useContext(ShellContext).info;

export function Kbd({ keys }: { keys: string }) {
  return <span className="kbd">{keyLabel(keys)}</span>;
}

/** The welcome on first launch, then the app. Nothing is drawn until the setting is read, so the app doesn't flash. */
export function Shell() {
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  useEffect(() => {
    backend.getSetting(WELCOMED).then((v) => setWelcomed(v !== null));
  }, []);
  if (welcomed === null) return null;
  if (!welcomed) return <Welcome onDone={() => setWelcomed(true)} />;
  return <AppShell />;
}

/** The phrase translator (DESIGN.md, "Results") downloads by itself when the app opens, after the speech
 * model if that is still coming, so the two don't share the connection. Nothing to decide. */
function useTranslatorDownload() {
  useEffect(() => {
    let off = () => {};
    let live = true;
    (async () => {
      const t = await backend.translationModel();
      if (!live || t.installed || t.downloading) return;
      const start = () => backend.downloadTranslation().catch(() => {});
      const speech = (await backend.models()).find((m) => m.available);
      if (!live) return;
      if (speech && !speech.installed) {
        // Started by the welcome, or by the first transcription; if neither comes within a minute, go anyway.
        const timer = window.setTimeout(() => {
          off();
          start();
        }, 60_000);
        const stop = on("model-download", (p) => {
          if (p.id === speech.id && p.state !== "downloading") {
            off();
            start();
          }
        });
        off = () => {
          window.clearTimeout(timer);
          stop();
        };
      } else start();
    })();
    return () => {
      live = false;
      off();
    };
  }, []);
}

function AppShell() {
  useTranslatorDownload();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [keys, setKeys] = useState<Keys>([]);
  const [status, setStatus] = useState("");
  const [focus, setFocus] = useState(false);
  const navigate = useNavigate();
  const downloads = useDownloads();
  const inProgress = useInProgress();

  useEffect(() => {
    backend.appInfo().then(setInfo);
  }, []);

  // App-wide shortcuts: Mod , for Settings, Mod 1–5 for the sidebar, Mod K to search, Mod O to add audio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!modKey(e) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (k === "k") {
        e.preventDefault();
        navigate("/podcasts", { state: { focus: Date.now() } });
      } else if (k === "o") {
        e.preventDefault();
        addAudio().then((added) => added && navigate("/library", { state: { added } }));
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        navigate(NAV[Number(e.key) - 1].to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <ShellContext.Provider value={{ info, setKeys, setStatus, focus, setFocus }}>
      <div className={["app", isMac && "mac", focus && "focus"].filter(Boolean).join(" ")}>
        <div className="app-body">
          <nav className="side" aria-label="Main" data-tauri-drag-region>
            <div className="ws" data-tauri-drag-region>
              Eksigo
            </div>
            <button className="search" type="button" onClick={() => navigate("/podcasts", { state: { focus: Date.now() } })}>
              <Icon name="search" size={14} stroke={1.8} />
              Search
              <span style={{ flexGrow: 1 }} />
              <Kbd keys="Mod K" />
            </button>
            {NAV.map((n, i) => (
              <NavLink key={n.to} to={n.to} className="nav" title={keyLabel(`Mod ${i + 1}`)}>
                <Icon name={n.icon} />
                {n.label}
              </NavLink>
            ))}
            <div className="sect">In progress</div>
            {inProgress.length === 0 ? (
              <div className="side-empty">Episodes you start appear here.</div>
            ) : (
              inProgress.slice(0, 6).map((p) => (
                <NavLink key={p.attemptId} to={dictationPath(p.itemId)} className="nav" title={`${p.title} · ${p.source}`}>
                  <span className="dot dot-ring" aria-hidden="true" style={{ margin: "0 4px" }} />
                  <span className="ell" style={{ flexGrow: 1 }}>
                    {p.title}
                  </span>
                  <span className="n">{progressLabel(p)}</span>
                </NavLink>
              ))
            )}
            <div style={{ flexGrow: 1 }} />
            <AccountChip />
            <NavLink to="/settings" className="nav">
              <Icon name="settings" />
              Settings
              <span className="n">{keyLabel("Mod ,")}</span>
            </NavLink>
          </nav>
          <main className="main">
            <Outlet />
          </main>
        </div>
        <footer className="statusbar">
          <span>
            <span className={info?.whisperBackend === "—" ? "dot" : "dot dot-ok"} aria-hidden="true" />
            {info?.whisperBackend === "—" ? "Browser preview · no speech engine" : `Whisper · ${info?.whisperBackend ?? "…"} on this computer`}
          </span>
          {downloads.size > 0 && <DownloadStatus />}
          <TranscriptActivity />
          <UpdateStatus />
          {status && <span>{status}</span>}
          <span style={{ flexGrow: 1 }} />
          {keys.map(([k, label]) => (
            <span key={k}>
              <Kbd keys={k} />
              {label}
            </span>
          ))}
          <span className="mono" style={{ fontSize: 11 }}>
            v{info?.version ?? ""}
          </span>
        </footer>
      </div>
    </ShellContext.Provider>
  );
}

/** Above Settings: "Sign in to sync", or who is signed in (design D14). Both open Settings › Account; Settings
 * itself shows as the open screen. */
function AccountChip() {
  const { account } = useAccount();
  if (account === undefined) return null;
  const to = "/settings?s=account";
  if (!account)
    return (
      <NavLink to={to} className={() => "nav"} style={{ color: "var(--ink-subtle)" }}>
        <Icon name="user" />
        Sign in to sync
      </NavLink>
    );
  const name = displayName(account);
  return (
    <NavLink to={to} className={() => "nav"} title={account.email ?? name} style={{ fontWeight: 500 }}>
      <span className="avatar avatar-sm" aria-hidden="true">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="ell" style={{ flexGrow: 1 }}>
        {name}
      </span>
    </NavLink>
  );
}

/** A new version downloaded in the background, ready once the app restarts. */
function UpdateStatus() {
  const u = useUpdate();
  if (u.state !== "ready") return null;
  return (
    <span>
      Version {u.version} is ready
      <button type="button" className="link-btn" style={{ fontSize: 12 }} onClick={() => restartToUpdate()}>
        Restart to update
      </button>
    </span>
  );
}

function DownloadStatus() {
  const downloads = [...useDownloads().values()];
  const known = downloads.map(fraction).filter((f): f is number => f !== null);
  const pct = known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100) : null;
  return (
    <span>
      <span className="track" style={{ width: 48 }} aria-hidden="true">
        <span className="fill" style={{ display: "block", width: `${pct ?? 0}%` }} />
      </span>
      Downloading {downloads.length > 1 ? `${downloads.length} episodes` : "an episode"}
      {pct !== null && ` · ${pct}%`}
    </span>
  );
}

function TranscriptActivity() {
  const { transcripts, model, translation } = useActivity();
  if (model) {
    return (
      <span>
        <Bar fraction={model.received / model.total} />
        Downloading the speech model · {Math.round((model.received / model.total) * 100)}%
      </span>
    );
  }
  const busy = [...transcripts.values()].filter((t) => isBusy(t.state));
  const running = busy.find((t) => t.state === "running");
  if (!running) {
    // Below a transcription: it's the thing the learner is waiting for.
    if (!translation) return null;
    return (
      <span>
        <Bar fraction={translation.received / translation.total} />
        Downloading the phrase translator · {Math.round((translation.received / translation.total) * 100)}%
      </span>
    );
  }
  const f = transcribed(running);
  return (
    <span title={running.title}>
      <Bar fraction={f} />
      <span className="ell" style={{ maxWidth: 260 }}>
        Transcribing {running.title}
      </span>
      · {Math.round(f * 100)}%{busy.length > 1 && ` · ${busy.length - 1} waiting`}
    </span>
  );
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <span className="track" style={{ width: 48 }} aria-hidden="true">
      <span className="fill" style={{ display: "block", width: `${Math.round(fraction * 100)}%` }} />
    </span>
  );
}

/** A screen inside the shell: the top bar with its breadcrumb, then the scrolling content. */
export function Page({
  crumbs,
  keys = [],
  status = "",
  actions,
  children,
}: {
  /** The path in the top bar; a crumb with a link goes there when clicked. */
  crumbs: (string | { label: string; to: string })[];
  keys?: Keys;
  /** Shown in the status bar while the page is open. */
  status?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { setKeys, setStatus } = useContext(ShellContext);
  const navigate = useNavigate();
  const keyString = JSON.stringify(keys);
  useEffect(() => {
    setKeys(JSON.parse(keyString));
  }, [keyString, setKeys]);
  useEffect(() => {
    setStatus(status);
    return () => setStatus("");
  }, [status, setStatus]);

  return (
    <>
      <div className="topbar" data-tauri-drag-region>
        {crumbs.map((c, i) => {
          const label = typeof c === "string" ? c : c.label;
          return (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {i === crumbs.length - 1 ? (
                <b className="ell">{label}</b>
              ) : typeof c === "string" ? (
                <span className="ell">{label}</span>
              ) : (
                <button type="button" className="crumb ell" onClick={() => navigate(c.to)}>
                  {label}
                </button>
              )}
            </span>
          );
        })}
        <span style={{ flexGrow: 1 }} data-tauri-drag-region />
        {actions}
      </div>
      <div className="content">{children}</div>
    </>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { backend, type AppInfo } from "../lib/backend";
import { isMac, keyLabel, modKey } from "../lib/platform";
import { Icon, type IconName } from "./Icon";

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: "/today", label: "Today", icon: "today" },
  { to: "/podcasts", label: "Podcasts", icon: "podcasts" },
  { to: "/library", label: "Library", icon: "library" },
  { to: "/words", label: "My words", icon: "words" },
  { to: "/progress", label: "Progress", icon: "progress" },
];

type Keys = [keys: string, label: string][];

const ShellContext = createContext<{ info: AppInfo | null; setKeys: (k: Keys) => void }>({
  info: null,
  setKeys: () => {},
});

export const useAppInfo = () => useContext(ShellContext).info;

export function Kbd({ keys }: { keys: string }) {
  return <span className="kbd">{keyLabel(keys)}</span>;
}

export function Shell() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [keys, setKeys] = useState<Keys>([]);
  const navigate = useNavigate();

  useEffect(() => {
    backend.appInfo().then(setInfo);
  }, []);

  // App-wide shortcuts: Mod , for Settings, Mod 1–5 for the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!modKey(e) || e.altKey || e.shiftKey) return;
      if (e.key === ",") {
        e.preventDefault();
        navigate("/settings");
      } else if (/^[1-5]$/.test(e.key)) {
        e.preventDefault();
        navigate(NAV[Number(e.key) - 1].to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <ShellContext.Provider value={{ info, setKeys }}>
      <div className={isMac ? "app mac" : "app"}>
        <div className="app-body">
          <nav className="side" aria-label="Main" data-tauri-drag-region>
            <div className="ws" data-tauri-drag-region>
              Eksigo
            </div>
            <button className="search" type="button" disabled title="Search arrives with podcasts (day 2)">
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
            <div className="side-empty">Episodes you start appear here.</div>
            <div style={{ flexGrow: 1 }} />
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

/** A screen inside the shell: the top bar with its breadcrumb, then the scrolling content. */
export function Page({
  crumbs,
  keys = [],
  actions,
  children,
}: {
  crumbs: string[];
  keys?: Keys;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { setKeys } = useContext(ShellContext);
  const keyString = JSON.stringify(keys);
  useEffect(() => {
    setKeys(JSON.parse(keyString));
  }, [keyString, setKeys]);

  return (
    <>
      <div className="topbar" data-tauri-drag-region>
        {crumbs.map((c, i) => (
          <span key={i} style={{ display: "contents" }}>
            {i > 0 && <span aria-hidden="true">/</span>}
            {i === crumbs.length - 1 ? <b>{c}</b> : <span>{c}</span>}
          </span>
        ))}
        <span style={{ flexGrow: 1 }} data-tauri-drag-region />
        {actions}
      </div>
      <div className="content">{children}</div>
    </>
  );
}

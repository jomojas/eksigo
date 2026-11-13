import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { backend, inApp, isTranslationModel, on, type Account, type AiModel, type AiStatus, type DictionaryList, type ModelInfo, type StorageUsage, type TranslationModel } from "../lib/backend";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Kbd, Page, useAppInfo } from "../components/Shell";
import { Icon } from "../components/Icon";
import { bytes, plural } from "../lib/format";
import { isMac } from "../lib/platform";
import { useActivity } from "../lib/transcripts";
import { PlaybackSettings } from "../components/DictationSettings";
import { useDictationSettings } from "../lib/dictation";
import { MEANING_LANGUAGES, useMeaningLanguage } from "../lib/words";
import { checkForUpdate, restartToUpdate, useUpdate } from "../lib/updates";
import { cancelSignIn, deleteAccount, displayName, providerName, signIn, signOut, useAccount } from "../lib/account";
import { syncedAgo, syncNow, useSync } from "../lib/sync";
import { cancelConnect, connectChatGpt, disconnectChatGpt, removeKey, saveKey, setModel, useAi } from "../lib/ai";

// Settings (design D12): every section, with AI (D16). The open
// section is in the address (#/settings?s=storage), so other screens can link straight to one.

type SectionId = "general" | "dictation" | "speech" | "dictionaries" | "ai" | "account" | "storage" | "shortcuts" | "about";

const SECTIONS: { id: SectionId; label: string; later?: boolean; words: string }[] = [
  { id: "general", label: "General", words: "theme light dark appearance" },
  { id: "dictation", label: "Dictation", words: "playback speed plays mode auto manual pause slow" },
  { id: "speech", label: "Speech model", words: "whisper transcription model download phrase translator machine translation" },
  { id: "dictionaries", label: "Dictionaries", words: "meanings language translation chinese japanese korean spanish french english" },
  { id: "ai", label: "AI", words: "chatgpt key openai deepseek anthropic groq openrouter explain review" },
  { id: "account", label: "Account and sync", words: "sign in apple google iphone sync" },
  { id: "storage", label: "Storage", words: "space disk size folder data episodes audio delete" },
  { id: "shortcuts", label: "Shortcuts", words: "keys keyboard" },
  { id: "about", label: "About", words: "version update updates licence license credits" },
];

export function Settings() {
  const [params, setParams] = useSearchParams();
  const section: SectionId = SECTIONS.some((x) => x.id === params.get("s")) ? (params.get("s") as SectionId) : "general";
  const setSection = (s: SectionId) => setParams({ s }, { replace: true });
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const q = query.trim().toLowerCase();
  const shown = q ? SECTIONS.filter((s) => `${s.label} ${s.words}`.toLowerCase().includes(q)) : SECTIONS;
  const label = SECTIONS.find((s) => s.id === section)!.label;

  // Esc clears the search, then leaves Settings for the previous screen.
  const escape = useRef(() => {});
  escape.current = () => {
    if (query) setQuery("");
    else navigate(-1);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") escape.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Page crumbs={["Settings", label]} keys={[["Esc", "Back"]]}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        <nav aria-label="Settings sections" style={{ width: 210, flexShrink: 0, padding: "20px 12px", borderRight: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 1 }}>
          <label className="input" style={{ height: 30, marginBottom: 12 }}>
            <Icon name="search" size={13} />
            <input
              type="search"
              placeholder="Search settings"
              aria-label="Search settings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && shown[0]) setSection(shown[0].id);
              }}
            />
          </label>
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === section ? "nav active" : "nav"}
              aria-current={s.id === section ? "page" : undefined}
              style={{ width: "100%", border: 0, background: s.id === section ? undefined : "transparent", cursor: "pointer", fontWeight: s.id === section ? 500 : 400 }}
              onClick={() => setSection(s.id)}
            >
              {s.label}
              {s.later && <span className="n">later</span>}
            </button>
          ))}
          {shown.length === 0 && <div className="muted" style={{ fontSize: 12, padding: "6px 8px" }}>Nothing matches “{query}”.</div>}
        </nav>
        <div className="page" style={{ flexGrow: 1, minWidth: 0 }}>
          {section === "general" && <General />}
          {section === "dictation" && <Dictation />}
          {section === "speech" && <Speech />}
          {section === "dictionaries" && <Dictionaries />}
          {section === "ai" && <AiSection />}
          {section === "account" && <AccountSection />}
          {section === "storage" && <Storage onOpen={setSection} />}
          {section === "shortcuts" && <Shortcuts />}
          {section === "about" && <About />}
        </div>
      </div>
    </Page>
  );
}

function Header({ title, text }: { title: string; text?: string }) {
  return (
    <div>
      <h1 className="h1">{title}</h1>
      {text && (
        <p className="muted" style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, maxWidth: 640 }}>
          {text}
        </p>
      )}
    </div>
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

/** AI (design D16): ChatGPT first, Premium later, and the learner's own key under Advanced. */
/** Which of the plan's models answers: Eksigo picks a small one unless the learner picks another. */
function ModelRow({ chatgpt }: { chatgpt: NonNullable<AiStatus["chatgpt"]> }) {
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    backend.aiModels().then(
      (m) => live && setModels(m),
      () => live && setModels([]),
    );
    return () => {
      live = false;
    };
  }, []);
  const current = chatgpt.model;
  const name = (slug: string | null) => models?.find((m) => m.slug === slug)?.name ?? slug;
  const value = chatgpt.chosen && current ? current : "";
  // The one in use stays listed even when the list couldn't be read.
  const listed = models && current && chatgpt.chosen && !models.some((m) => m.slug === current) ? [...models, { slug: current, name: current, small: false }] : (models ?? []);
  return (
    <div className="ai-kv">
      <span>Model</span>
      <span style={{ marginLeft: "auto", fontSize: 12 }}>{error ?? "Small ones are faster and use less of your limit"}</span>
      <select
        className="select"
        style={{ margin: "4px 0", maxWidth: 240 }}
        value={value}
        disabled={models === null}
        onChange={(e) => {
          setError(null);
          setModel(e.target.value || null).catch((err) => setError(String(err)));
        }}
        aria-label="Model"
      >
        <option value="">Automatic{!chatgpt.chosen && current ? ` · ${name(current)}` : " (recommended)"}</option>
        {listed.map((m) => (
          <option key={m.slug} value={m.slug}>
            {m.name}
            {m.small ? " · faster, uses less" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function AiSection() {
  const { status, waiting, error } = useAi();
  const [lang] = useMeaningLanguage();
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const chatgpt = status?.chatgpt ?? null;
  const connected = !!chatgpt && !chatgpt.reconnect;
  const language = MEANING_LANGUAGES.find(([c]) => c === lang)?.[1] ?? "English";
  if (status === undefined) return null;
  return (
    <section aria-labelledby="ai" style={{ maxWidth: 680, display: "flex", flexDirection: "column" }}>
      <h1 id="ai" className="h1">
        AI
      </h1>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, marginTop: 8, maxWidth: 620 }}>
        AI explains words in their sentence when you ask, answers your questions about a sentence (like why you missed it), and reviews each episode you finish. It uses an AI you already have.
        Only the sentence and what you typed are sent, never the audio.
      </p>

      <div className="panel ai-card" style={{ marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="ai-logo" aria-hidden="true">
            <Icon name="chat" size={18} />
          </span>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="account-row-t">ChatGPT</span>
              {connected && !chatgpt.limited && (
                <span className="badge" style={{ height: 20, fontSize: 11 }}>
                  <span className="dot dot-ok" aria-hidden="true" />
                  Connected
                </span>
              )}
              {connected && chatgpt.limited && (
                <span className="badge" style={{ height: 20, fontSize: 11 }}>
                  <span className="dot dot-bad" aria-hidden="true" />
                  Weekly limit reached
                </span>
              )}
            </div>
            <div className="account-row-h" style={{ marginTop: 3 }}>
              {chatgpt?.reconnect
                ? "The connection to ChatGPT ended. Connect again to keep using your plan."
                : "For ChatGPT Plus and Pro. Eksigo uses your plan, so there's nothing extra to pay."}
            </div>
          </div>
          {!connected && !waiting && (
            <button type="button" className="btn btn-primary" style={{ height: 36, padding: "0 14px" }} onClick={connectChatGpt}>
              {chatgpt?.reconnect ? "Connect again" : "Continue with ChatGPT"}
            </button>
          )}
        </div>

        {waiting && (
          <div role="status" style={{ display: "flex", gap: 14, alignItems: "flex-start", borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
            <span className="spin" aria-hidden="true" />
            <div style={{ flexGrow: 1 }}>
              <div className="account-row-t">Finish connecting in your browser</div>
              <div className="account-row-h">
                {inApp
                  ? "OpenAI's page opened in your browser. Sign in, then allow Eksigo to use your ChatGPT plan. Eksigo carries on here when you're done."
                  : "In the app, OpenAI's page opens in your browser. Here in the preview, ChatGPT connects after two seconds."}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-sm" onClick={() => backend.aiOpenAgain()}>
                  <Icon name="external" size={13} />
                  Open the page again
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={cancelConnect}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {connected && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {chatgpt.limited && (
              <div className="ai-warn" role="alert" style={{ marginBottom: 12 }}>
                <Icon name="alert" size={16} />
                <div style={{ flexGrow: 1 }}>
                  <div className="account-row-t">You've used this week's limit for Eksigo</div>
                  <div className="account-row-h" style={{ color: "var(--ink-muted)" }}>
                    You set it in ChatGPT. AI comes back when the limit resets, or raise it now. Dictation, looking words up and practice work as usual.
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => backend.manageUsage()}>
                  Manage usage
                  <Icon name="external" size={12} />
                </button>
              </div>
            )}
            <div className="ai-kv">
              <span>Account</span>
              <b>{[chatgpt.email, chatgpt.plan && chatgpt.plan[0].toUpperCase() + chatgpt.plan.slice(1)].filter(Boolean).join(" · ") || "Connected"}</b>
            </div>
            {!chatgpt.reconnect && <ModelRow chatgpt={chatgpt} />}
            <div className="ai-kv">
              <span>Using ChatGPT plan</span>
              <b style={{ fontWeight: 400, color: "var(--ink-subtle)" }}>for explanations and reviews, up to the weekly limit you set in ChatGPT</b>
            </div>
            <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "1px solid var(--hairline)" }}>
              {!chatgpt.limited && (
                <button type="button" className="btn btn-sm" onClick={() => backend.manageUsage()}>
                  Manage usage
                  <Icon name="external" size={12} />
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await disconnectChatGpt().catch(() => {});
                  setBusy(false);
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="notice notice-error" role="alert" style={{ fontSize: 13 }}>
            {error}
          </div>
        )}
      </div>

      <div className="panel ai-card" style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 14 }}>
        <span className="ai-logo" aria-hidden="true" style={{ font: "600 15px/1 var(--font-display)" }}>
          E
        </span>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="account-row-t">Eksigo Premium</div>
          <div className="account-row-h" style={{ marginTop: 3 }}>
            For when you don't have ChatGPT: subscribe once on eksigo.com, nothing to set up.
          </div>
        </div>
        <span className="badge badge-next">Later</span>
      </div>

      <button type="button" className="ai-disclosure" aria-expanded={advanced || !!status.key} onClick={() => setAdvanced((a) => !a)} disabled={!!status.key}>
        <Icon name={advanced || status.key ? "chevron" : "chevron-right"} size={12} />
        Advanced
      </button>
      {!(advanced || status.key) ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 8, paddingLeft: 20 }}>
          Use my own API key: OpenAI, DeepSeek, Anthropic, Groq, OpenRouter or any OpenAI-compatible service.
        </div>
      ) : (
        <OwnKey />
      )}

      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginTop: 22, paddingTop: 14, borderTop: "1px solid var(--hairline)" }}>
        Explanations are written in {language}, your language in General.{status.key && chatgpt ? " With ChatGPT and a key both set, Eksigo uses ChatGPT." : ""}
      </p>
    </section>
  );
}

const KEY_PROVIDERS: [string, string][] = [
  ["openai", "OpenAI"],
  ["deepseek", "DeepSeek"],
  ["anthropic", "Anthropic"],
  ["groq", "Groq"],
  ["openrouter", "OpenRouter"],
  ["other", "Other"],
];

/** The learner's own API key: tested before it's kept, then shown without the key itself. */
function OwnKey() {
  const { status } = useAi();
  const saved = status?.key ?? null;
  const [provider, setProvider] = useState(saved?.provider ?? "openai");
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = isMac ? "Mac Keychain" : "Windows Credential Manager";
  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveKey({ provider, baseUrl, model }, secret);
      setSecret("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  if (saved)
    return (
      <div className="panel ai-card" style={{ marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="account-row-t">Your own API key</span>
          <span className="badge" style={{ height: 20, fontSize: 11 }}>
            <span className="dot dot-ok" aria-hidden="true" />
            {status?.using === "key" ? "In use" : "Kept"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-muted)" }}>
          <span className="dot dot-ok" aria-hidden="true" />
          Works with {saved.name}, model {saved.model}.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12, borderTop: "1px solid var(--hairline)", fontSize: 12 }} className="muted">
          <Icon name="lock" size={13} />
          <span style={{ flexGrow: 1 }}>
            Kept in the {store} and sent only to {saved.name}, never to Eksigo.
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeKey()}>
            Remove key
          </button>
        </div>
      </div>
    );
  return (
    <div className="panel ai-card" style={{ marginTop: 10 }}>
      <span className="account-row-t">Your own API key</span>
      <span className="seg" role="group" aria-label="Provider" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {KEY_PROVIDERS.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={provider === id} onClick={() => setProvider(id)}>
            {name}
          </button>
        ))}
      </span>
      {provider === "other" && (
        <label className="lookup-note">
          Address (OpenAI-compatible)
          <span className="input">
            <input type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} />
          </span>
        </label>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <label className="lookup-note" style={{ flexGrow: 1 }}>
          Key
          <span className="input">
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && test()}
              placeholder="Paste the key"
              autoComplete="off"
              spellCheck={false}
              className="mono"
            />
          </span>
        </label>
        <label className="lookup-note" style={{ width: 190 }}>
          Model{provider === "other" ? "" : " (optional)"}
          <span className="input">
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === "other" ? "model name" : "the usual one"} spellCheck={false} />
          </span>
        </label>
        <button type="button" className="btn" disabled={busy || !secret.trim()} onClick={test}>
          {busy ? "Testing…" : "Test key"}
        </button>
      </div>
      {error && (
        <div className="notice notice-error" role="alert" style={{ fontSize: 13 }}>
          {error}
        </div>
      )}
      <div className="muted" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <Icon name="lock" size={13} />
        The key is kept only when it works: in the {store}, sent only to the provider.
      </div>
    </div>
  );
}

/** Account and sync (design D14). Optional: everything works without one. */
function AccountSection() {
  const { account, waiting, error } = useAccount();
  return (
    <section aria-labelledby="account" style={{ maxWidth: 680 }}>
      <h1 id="account" className="h1">
        Account and sync
      </h1>
      {account === undefined ? null : account ? (
        <SignedIn account={account} />
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, lineHeight: 1.55, marginTop: 8, maxWidth: 600 }}>
            An account keeps your words and practice the same on this computer and your iPhone. Everything works without one; nothing you've done is lost
            when you sign in.
          </p>
          {waiting ? (
            <div className="account-wait" role="status">
              <span className="spin" aria-hidden="true" />
              <div style={{ flexGrow: 1 }}>
                <div className="account-row-t">Finish signing in in your browser</div>
                <div className="account-row-h">
                  {inApp
                    ? `A ${providerName(waiting)} sign-in page opened in your browser. Eksigo carries on here when you're done.`
                    : `In the app, a ${providerName(waiting)} sign-in page opens in your browser. Here in the preview, you're signed in after two seconds.`}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-sm" onClick={() => backend.openSignInAgain()}>
                    <Icon name="upload" size={13} />
                    Open the page again
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={cancelSignIn}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, marginTop: 24 }}>
              <button type="button" className="btn provider provider-apple" onClick={() => signIn("apple")}>
                <AppleLogo />
                Continue with Apple
              </button>
              <button type="button" className="btn provider" onClick={() => signIn("google")}>
                <GoogleLogo />
                Continue with Google
              </button>
              <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
                Your browser opens to sign in, then sends you back here.
              </p>
            </div>
          )}
          {error && (
            <div className="notice notice-error" role="alert" style={{ marginTop: 16, fontSize: 13 }}>
              {error}
            </div>
          )}
          <div className="syncs" aria-label="What syncs">
            <div>
              <Icon name="words" size={15} />
              <span>
                <b>My words</b>Each word with its sentences, your notes, its level and when it's next due.
              </span>
            </div>
            <div>
              <Icon name="progress" size={15} />
              <span>
                <b>Practice days</b>Minutes per day, so your streak and Progress are the same everywhere.
              </span>
            </div>
            <div>
              <Icon name="headphones" size={15} />
              <span>
                <b>Listening</b>Which episodes you've listened to, and where you stopped.
              </span>
            </div>
            <div>
              <Icon name="lock" size={15} />
              <span>
                <b>Stays on this computer</b>Audio, transcripts and what you typed, sentence by sentence.
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** Sync (design D20): it runs by itself; this says how it went, with Sync now for when you can't wait. */
function SyncRow() {
  const sync = useSync();
  if (!sync) return null;
  const syncing = sync.state === "syncing";
  const counts = `${plural(sync.words, "word")}, ${plural(sync.days, "practice day")}`;
  const help = syncing && sync.first
    ? `Adding this computer's ${counts} to your account.`
    : sync.state === "failed"
      ? (sync.error ?? "Couldn't sync.")
      : `Automatic: when Eksigo opens, after each session, and every few minutes. On this computer: ${counts}, ${plural(sync.episodes, "episode")}.`;
  return (
    <div className="account-row">
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <div className="account-row-t">Sync</div>
        <div className="account-row-h">{help}</div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }} role="status">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-muted)" }}>
          {syncing ? (
            <>
              <span className="spin spin-sm" aria-hidden="true" />
              Syncing…
            </>
          ) : sync.state === "failed" ? (
            <>
              <span className="dot dot-bad" aria-hidden="true" />
              {sync.last ? `Last synced ${syncedAgo(sync.last)}` : "Not synced yet"}
            </>
          ) : (
            <>
              <span className="dot dot-ok" aria-hidden="true" />
              {sync.last ? `Synced ${syncedAgo(sync.last)}` : "Not synced yet"}
            </>
          )}
        </span>
        <button type="button" className="btn btn-sm" disabled={syncing} onClick={() => syncNow().catch(() => {})}>
          {sync.state === "failed" ? "Try now" : "Sync now"}
        </button>
      </div>
    </div>
  );
}

function SignedIn({ account }: { account: Account }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const name = displayName(account);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20, paddingBottom: 20, borderBottom: "1px solid var(--hairline)" }}>
        <span className="avatar" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="ell" style={{ font: "600 16px/1.3 var(--font-display)", letterSpacing: -0.2, color: "var(--ink)" }}>
            {name}
          </div>
          <div className="muted ell" style={{ fontSize: 13, marginTop: 3 }}>
            {[account.email, `signed in with ${providerName(account.provider)}`].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="badge">{account.plan === "premium" ? "Premium" : "Free"}</span>
      </div>
      <SyncRow />
      <div className="account-row">
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="account-row-t">Plan</div>
          <div className="account-row-h">
            {account.plan === "premium" ? "Premium: everything, with AI included." : "Free: everything except the AI features. Premium, for AI without your own subscription, comes later."}
          </div>
        </div>
        {account.plan !== "premium" && (
          <span className="badge badge-next" style={{ flexShrink: 0 }}>
            Premium · later
          </span>
        )}
      </div>
      <div className="account-row">
        <div style={{ flexGrow: 1, minWidth: 0 }}>
          <div className="account-row-t">Sign out</div>
          <div className="account-row-h">Your words and practice stay on this computer; they just stop syncing.</div>
        </div>
        <button type="button" className="btn" style={{ flexShrink: 0 }} disabled={busy} onClick={() => run(signOut)}>
          Sign out
        </button>
      </div>
      {confirm ? (
        <div className="account-confirm" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-text">
          <div id="delete-title" className="account-row-t">
            Delete your account?
          </div>
          <div id="delete-text" style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink-muted)" }}>
            Your account and everything synced to it are removed from Eksigo's server, and your iPhone signs out. This can't be undone. Everything stays on
            this computer.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(deleteAccount)}>
              {busy ? "Deleting…" : "Delete account"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(false)} autoFocus>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="account-row" style={{ borderBottom: "none" }}>
          <div style={{ flexGrow: 1, minWidth: 0 }}>
            <div className="account-row-t">Delete account</div>
            <div className="account-row-h">Removes your account and everything synced from Eksigo's server. This computer keeps its own copy.</div>
          </div>
          <button type="button" className="btn btn-ghost danger" style={{ flexShrink: 0 }} disabled={busy} onClick={() => setConfirm(true)}>
            Delete account…
          </button>
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert" style={{ marginTop: 16, fontSize: 13 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function AppleLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.7zM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z" />
    </svg>
  );
}

export function GoogleLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 01-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.7H2.1v2.8A11 11 0 0012 23z" />
      <path fill="#FBBC05" d="M5.7 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.2H2.1a11 11 0 000 9.6z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0012 1 11 11 0 002.1 7.2L5.7 10c.9-2.7 3.4-4.6 6.3-4.6z" />
    </svg>
  );
}

function Dictation() {
  const [settings, update] = useDictationSettings();
  return (
    <section aria-labelledby="dictation">
      <h1 id="dictation" className="h1">
        Dictation
      </h1>
      <p className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
        How each sentence plays. The same settings are beside every dictation, where changes also become these defaults.
      </p>
      <div style={{ marginTop: 20 }}>
        <PlaybackSettings settings={settings} update={update} />
      </div>
    </section>
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
      <h1 id="speech" className="h1">Speech model</h1>
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
        <Translator />
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

/** The phrase translator: downloaded by itself when the app first opens, so there's normally nothing to do. */
function Translator() {
  const { translation: progress } = useActivity();
  const [t, setT] = useState<TranslationModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.translationModel().then(setT);
  }, []);
  useEffect(load, [load]);
  useEffect(
    () =>
      on("model-download", (p) => {
        if (!isTranslationModel(p.id) || p.state === "downloading") return;
        setError(p.state === "failed" ? p.error : null);
        load();
      }),
    [load],
  );
  if (!t) return null;
  const pct = progress ? Math.round((progress.received / progress.total) * 100) : null;
  return (
    <Row label="Phrase translator" hint={`${t.name} · ${bytes(t.bytes)} · translates phrases the dictionary doesn't have, on this computer${error ? ` · ${error}` : ""}`}>
      {pct !== null ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="track" style={{ width: 120 }}>
            <span className="fill" style={{ display: "block", width: `${pct}%` }} />
          </span>
          <span className="mono" style={{ fontSize: 12 }}>
            {pct}%
          </span>
        </div>
      ) : t.installed ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="dot dot-ok" />
          Downloaded
        </span>
      ) : (
        <button type="button" className="btn" onClick={() => backend.downloadTranslation().catch(() => {})}>
          Download
        </button>
      )}
    </Row>
  );
}

const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(MEANING_LANGUAGES);

/** The offline dictionaries: which language meanings are shown in, and what's downloaded. */
function Dictionaries() {
  const [lang, setLang] = useMeaningLanguage();
  const [list, setList] = useState<DictionaryList | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.dictionaries().then(setList, (e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  const act = async (code: string, f: () => Promise<void>) => {
    setBusy(code);
    setError(null);
    setConfirm(null);
    try {
      await f();
    } catch (e) {
      setError(String(e));
    }
    setBusy(null);
    load();
  };

  // The chosen language first, then the English one its definitions come from, then the rest.
  const order = (c: string) => (c === lang ? 0 : c === "en" ? 1 : 2 + MEANING_LANGUAGES.findIndex(([x]) => x === c));
  const rows = [...(list?.dictionaries ?? [])].sort((a, b) => order(a.lang) - order(b.lang));

  return (
    <section aria-labelledby="dictionaries" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Header
        title="Dictionaries"
        text="Meanings for the words you look up in a review come from a dictionary on this computer, so looking up is instant and works offline. Each one downloads once, the first time it's needed, or here."
      />
      <div>
        <Row label="Word meanings in" hint="English definitions are shown beside the meanings, whatever the language.">
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Word meanings in">
            {MEANING_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Row>
      </div>
      {list?.offline && (
        <div className="notice" role="status" style={{ fontSize: 13 }}>
          The dictionary server can't be reached, so only the dictionaries on this computer are listed.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert" style={{ fontSize: 13 }}>
          {error}
        </div>
      )}
      <div className="panel" style={{ overflow: "hidden" }}>
        {!list && <div style={{ padding: 16 }} className="muted">Checking…</div>}
        {rows.map((d, i) => {
          const installed = d.installedVersion != null;
          const update = installed && d.latestVersion != null && d.latestVersion > d.installedVersion!;
          const used = d.lang === lang || d.lang === "en";
          return (
            <div
              key={d.lang}
              style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 14px", borderTop: i ? "1px solid var(--hairline)" : undefined, minHeight: 56 }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ color: "var(--ink)", fontWeight: 500 }}>{LANGUAGE_NAMES[d.lang] ?? d.lang}</b>
                  {d.lang === lang && <span className="badge" style={{ height: 18, fontSize: 11 }}>In use</span>}
                  {d.lang === "en" && d.lang !== lang && <span className="muted" style={{ fontSize: 12 }}>for the English definitions</span>}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {d.source || "—"} ·{" "}
                  {installed ? `${bytes(d.installedBytes)} on this computer${update ? " · a newer version is out" : ""}` : d.downloadBytes ? `${bytes(d.downloadBytes)} download` : "not downloaded"}
                </span>
              </span>
              <span style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                {busy === d.lang ? (
                  <span className="muted" style={{ fontSize: 12 }}>
                    {installed && !update ? "Removing…" : "Downloading…"}
                  </span>
                ) : confirm === d.lang ? (
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => act(d.lang, () => backend.removeDictionary(d.lang))}>
                      Remove
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    {(!installed || update) && d.latestVersion != null && (
                      <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => act(d.lang, () => backend.updateDictionary(d.lang))}>
                        {update ? "Update" : "Download"}
                      </button>
                    )}
                    {installed && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        disabled={!!busy}
                        title={used ? "It downloads again the next time you look a word up" : undefined}
                        onClick={() => setConfirm(d.lang)}
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 640 }}>
        ECDICT (MIT licence) for Chinese and English, EJDict (public domain) for Japanese, and Wiktionary's contributors (CC BY-SA) for Korean,
        Spanish and French.
      </p>
    </section>
  );
}

/** What Eksigo keeps on this computer, and where. */
function Storage({ onOpen }: { onOpen: (s: SectionId) => void }) {
  const [u, setU] = useState<StorageUsage | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    backend.storage().then(setU);
    // Downloads and removals elsewhere change the numbers.
    const offs = [on("library", () => backend.storage().then(setU)), on("model-download", (p) => p.state !== "downloading" && backend.storage().then(setU))];
    return () => offs.forEach((f) => f());
  }, []);

  const parts: { key: string; label: string; hint: string; n: number; tone: string; action?: [string, () => void] }[] = u
    ? [
        {
          key: "episodes",
          label: "Downloaded episodes",
          hint: `${plural(u.episodes, "episode")}. Remove the ones you're done with in the Library.`,
          n: u.episodesBytes,
          tone: "var(--ink-muted)",
          action: ["Library", () => navigate("/library")],
        },
        { key: "models", label: "Speech and translation models", hint: "For transcribing, and translating phrases, on this computer.", n: u.modelsBytes, tone: "var(--ink-subtle)", action: ["Speech model", () => onOpen("speech")] },
        { key: "dicts", label: "Dictionaries", hint: "Word meanings for looking up.", n: u.dictionariesBytes, tone: "var(--ink-tertiary)", action: ["Dictionaries", () => onOpen("dictionaries")] },
        { key: "db", label: "Your practice", hint: "Transcripts, dictations, My words and settings.", n: u.databaseBytes, tone: "var(--hairline-tertiary)" },
      ]
    : [];
  const total = parts.reduce((n, p) => n + p.n, 0);

  return (
    <section aria-labelledby="storage" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Header title="Storage" text="Everything stays on this computer. Episodes you download are kept until you remove them; your own files are never copied or moved." />
      {u && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span className="big" style={{ font: "600 22px/1 var(--font-display)", color: "var(--ink)" }}>
                {bytes(total)}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                used by Eksigo
              </span>
            </div>
            <div
              role="img"
              aria-label={parts.map((p) => `${p.label} ${bytes(p.n)}`).join(", ")}
              style={{ display: "flex", height: 8, borderRadius: 9999, overflow: "hidden", background: "var(--hairline)", gap: 2 }}
            >
              {parts
                .filter((p) => p.n > 0)
                .map((p) => (
                  <span key={p.key} style={{ width: `${(p.n / Math.max(total, 1)) * 100}%`, minWidth: 3, background: p.tone }} />
                ))}
            </div>
          </div>
          <div>
            {parts.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: p.tone, flexShrink: 0 }} />
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--ink)", fontWeight: 500 }}>{p.label}</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {p.hint}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 13, color: "var(--ink)", minWidth: 72, textAlign: "right" }}>
                  {bytes(p.n)}
                </span>
                <span style={{ width: 120, display: "flex", justifyContent: "flex-end" }}>
                  {p.action && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={p.action[1]}>
                      {p.action[0]}
                    </button>
                  )}
                </span>
              </div>
            ))}
            {u.ownFiles > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--hairline)" }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, border: "1px dashed var(--hairline-tertiary)", flexShrink: 0 }} />
                <div style={{ flexGrow: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--ink)", fontWeight: 500 }}>Your own files</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                    {plural(u.ownFiles, "file")}, left where they are. Not counted above.
                  </div>
                </div>
                <span className="mono muted" style={{ fontSize: 13, minWidth: 72, textAlign: "right" }}>
                  {bytes(u.ownFilesBytes)}
                </span>
                <span style={{ width: 120 }} />
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Kept in <span className="mono selectable">{u.dataDir}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => backend.reveal(u.dataDir)}>
              {isMac ? "Show in Finder" : "Show in File Explorer"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Everywhere",
    [
      ["Mod 1 – 5", "Today, Podcasts, Library, My words, Progress"],
      ["Mod K", "Search podcasts"],
      ["Mod O", "Add your own audio or video"],
      ["Mod ,", "Settings"],
      ["Esc", "Back, or close"],
    ],
  ],
  [
    "Dictation",
    [
      ["Tab", "Play the sentence"],
      ["Shift Enter", "Finish the sentence"],
      ["Shift Tab", "I know this one"],
      ["Mod D", "Flag the sentence for the review"],
      ["Mod P", "Play past your maximum"],
      ["Mod R", "Play it slower"],
      ["Mod ← →", "Previous or next sentence"],
      ["Mod ↓", "The first sentence not done"],
      ["Mod − = 0", "Slower, faster, normal speed"],
      ["Mod K", "Mark as an ad (left out of the score)"],
      ["Mod \\", "Focus: hide the sidebar"],
      ["_", "A gap for a word you didn't catch"],
      ["Esc", "Stop"],
    ],
  ],
  [
    "Listen",
    [
      ["L", "Listen (on the episode's page)"],
      ["Space", "Play or pause"],
      ["↑ ↓", "Previous or next sentence"],
      ["S", "Show or hide the sentence being heard"],
      ["Shift S", "Show or hide all sentences"],
      ["R", "Replay the sentence"],
      ["← →", "5 seconds"],
      ["Select", "Look the words up (in a shown sentence)"],
    ],
  ],
  [
    "Review and looking up",
    [
      ["Select", "Look the words up (double-click a word, or drag over a phrase)"],
      ["A", "Add to My words"],
      ["Esc", "Close the card"],
    ],
  ],
  [
    "Word practice",
    [
      ["P", "Practise (on My words)"],
      ["Tab", "Play the sentence again"],
      ["Mod R", "Play it slower"],
      ["Enter", "Check, then next as Good"],
      ["Space", "Show the meaning (recall)"],
      ["1 – 4", "Pick a meaning, or grade Again, Hard, Good, Easy"],
      ["Shift Tab", "Show the answer (counts as Again)"],
      ["Esc", "End the session"],
    ],
  ],
  [
    "Episode",
    [
      ["Space", "Play or pause"],
      ["← →", "Back or forward 5 seconds"],
      ["R", "Play the sentence again"],
    ],
  ],
  [
    "Podcasts and shows",
    [
      ["/", "Search podcasts"],
      ["↑ ↓", "Move through a show's episodes"],
      ["Enter", "Open"],
      ["D", "Download the episode"],
    ],
  ],
  [
    "Library and My words",
    [
      ["↑ ↓", "Move"],
      ["Enter", "Open"],
      ["Delete", "Remove from the Library"],
    ],
  ],
];

function Shortcuts() {
  return (
    <section aria-labelledby="shortcuts" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Header title="Shortcuts" text="Eksigo is made to be used from the keyboard. These can't be changed yet." />
      {SHORTCUTS.map(([group, keys]) => (
        <div key={group} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            {group}
          </div>
          {keys.map(([k, what]) => (
            <div key={k + what} style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 32, borderBottom: "1px solid var(--hairline)" }}>
              <span style={{ flexGrow: 1, color: "var(--ink)" }}>{what}</span>
              {/^[A-Z]?[a-z]/.test(k) && k.includes(" ") && !k.startsWith("Mod") && !k.startsWith("Shift") ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  {k}
                </span>
              ) : (
                <Kbd keys={k} />
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

const CREDITS: [string, string, string][] = [
  ["whisper.cpp", "MIT", "https://github.com/ggml-org/whisper.cpp"],
  ["Whisper speech models, by OpenAI", "MIT", "https://github.com/openai/whisper"],
  ["llama.cpp", "MIT", "https://github.com/ggml-org/llama.cpp"],
  [
    "Tencent HY-MT 1.5 translation model. Tencent HY is licensed under the Tencent HY Community License Agreement, Copyright © 2025 Tencent. All Rights Reserved. The trademark rights of “Tencent HY” are owned by Tencent or its affiliate.",
    "Tencent HY Community License",
    "https://huggingface.co/tencent/HY-MT1.5-1.8B/blob/main/License.txt",
  ],
  ["Qwen 2.5 language model, by Alibaba Cloud (used in the EU, the UK and South Korea)", "Apache 2.0", "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct"],
  ["ECDICT", "MIT", "https://github.com/skywind3000/ECDICT"],
  ["EJDict", "Public domain", "https://github.com/kujirahand/EJDict"],
  ["Wiktionary", "CC BY-SA", "https://www.wiktionary.org/"],
  ["Tauri", "MIT or Apache 2.0", "https://tauri.app/"],
  ["Podcast search: Apple Podcasts", "", "https://podcasts.apple.com/"],
];

/** The version check; the app also checks once each time it starts and downloads what it finds. */
function Updates() {
  const u = useUpdate();
  const text =
    !inApp ? "Updates are checked in the app, not in the browser preview."
    : u.state === "checking" ? "Checking…"
    : u.state === "current" ? "Eksigo is up to date."
    : u.state === "downloading" ? `Downloading version ${u.version}${u.fraction !== null ? ` · ${Math.round(u.fraction * 100)}%` : ""}`
    : u.state === "ready" ? `Version ${u.version} is downloaded and ready.`
    : u.state === "failed" ? "Couldn't check for updates. Check your connection and try again."
    : "Eksigo checks for a new version each time it starts.";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <span style={{ flexGrow: 1, fontSize: 13 }} role="status">
        {text}
      </span>
      {u.state === "ready" ? (
        <button type="button" className="btn btn-sm btn-primary" onClick={() => restartToUpdate()}>
          Restart to update
        </button>
      ) : (
        <button type="button" className="btn btn-sm" disabled={!inApp || u.state === "checking" || u.state === "downloading"} onClick={() => checkForUpdate()}>
          Check for updates
        </button>
      )}
    </div>
  );
}

function About() {
  const info = useAppInfo();
  return (
    <section aria-labelledby="about" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Header title="About" text="Eksigo: dictation practice with real podcasts, on your own computer." />
      <div className="panel" style={{ padding: "8px 16px" }}>
        <div className="prop">Version<b className="mono">{info?.version}</b></div>
        <div className="prop">System<b className="mono">{info?.os}</b></div>
        <div className="prop">Speech engine<b className="mono">{info?.whisperBackend}</b></div>
        <div className="prop">Database schema<b className="mono">{info?.schemaVersion}</b></div>
        <div className="prop">
          Licence
          <b>
            <button type="button" className="link-btn" style={{ fontSize: 13 }} onClick={() => backend.openUrl("https://github.com/jomojas/eksigo/blob/main/LICENSE")}>
              GNU AGPL v3
            </button>
          </b>
        </div>
      </div>
      <Updates />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={() => backend.openUrl("https://eksigo.com")}>
          eksigo.com
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => backend.openUrl("https://github.com/jomojas/eksigo/issues")}>
          Report a problem
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>
          Made with
        </div>
        {CREDITS.map(([name, licence, url]) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 32, borderBottom: "1px solid var(--hairline)" }}>
            <button type="button" className="link-btn" style={{ flexGrow: 1, textAlign: "left", fontSize: 13 }} onClick={() => backend.openUrl(url)}>
              {name}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {licence}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

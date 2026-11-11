// Podcasts: search Apple's directory or paste a feed link, your shows, and recommendations.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { Kbd, Page } from "../components/Shell";
import { backend, type Listing, type Show } from "../lib/backend";

type Tab = { key: string; label: string; genre: number | null; learners?: boolean };

// Apple's genre ids.
const TABS: Tab[] = [
  { key: "learners", label: "Good for learners", genre: null, learners: true },
  { key: "top", label: "Top", genre: null },
  { key: "education", label: "Education", genre: 1304 },
  { key: "science", label: "Science", genre: 1533 },
  { key: "society", label: "Society", genre: 1324 },
  { key: "business", label: "Business", genre: 1321 },
  { key: "news", label: "News", genre: 1489 },
];

const COUNTRIES: [string, string][] = [
  ["us", "United States"],
  ["gb", "United Kingdom"],
  ["au", "Australia"],
  ["ca", "Canada"],
  ["ie", "Ireland"],
  ["nz", "New Zealand"],
  ["in", "India"],
  ["sg", "Singapore"],
];

function defaultCountry(): string {
  const region = navigator.language.split("-")[1]?.toLowerCase();
  return COUNTRIES.some(([c]) => c === region) ? region! : "us";
}

const isLink = (s: string) => /^https?:\/\//i.test(s.trim());

export function Podcasts() {
  const navigate = useNavigate();
  const location = useLocation();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Listing[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [country, setCountry] = useState(defaultCountry);
  const [yours, setYours] = useState<Show[] | null>(null);

  useEffect(() => {
    backend.getSetting("country").then((c) => c && setCountry(c));
    backend.subscribed().then(setYours, () => setYours([]));
  }, []);

  // Mod K and the sidebar's Search arrive with a focus request; "/" focuses from anywhere on the page.
  useEffect(() => {
    if ((location.state as { focus?: number } | null)?.focus) input.current?.focus();
  }, [location.state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Search as you type, after a short pause.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || isLink(term)) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(() => {
      backend.search(term, country).then(
        (r) => {
          setResults(r);
          setError(null);
          setSearching(false);
        },
        (e) => {
          setError(String(e));
          setSearching(false);
        },
      );
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, country]);

  const submit = async () => {
    const term = query.trim();
    if (!isLink(term)) return;
    setBusy("feed");
    setError(null);
    try {
      navigate(`/podcasts/show/${await backend.addFeed(term)}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const open = useCallback(
    async (l: Listing, subscribe = false) => {
      const key = l.appleId ?? l.feedUrl ?? l.title;
      setBusy(key);
      setError(null);
      try {
        const id = await backend.openListing(l);
        if (subscribe) {
          await backend.subscribe(id, true);
          setYours(await backend.subscribed());
        } else navigate(`/podcasts/show/${id}`);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [navigate],
  );

  const subscribedFeeds = new Set(yours?.map((s) => s.feedUrl));
  const subscribedApple = new Set(yours?.map((s) => s.appleId).filter(Boolean));
  const isSubscribed = (l: Listing) => (l.feedUrl && subscribedFeeds.has(l.feedUrl)) || (l.appleId && subscribedApple.has(l.appleId));

  const changeCountry = (c: string) => {
    setCountry(c);
    backend.setSetting("country", c);
  };

  return (
    <Page crumbs={["Podcasts"]} keys={[["/", "Search"], ["Enter", "Open"]]}>
      <div className="page" style={{ gap: 28 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="input input-lg">
            <Icon name="search" size={16} stroke={1.8} />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  input.current?.blur();
                }
              }}
              placeholder="Search podcasts, or paste an RSS link"
              aria-label="Search podcasts, or paste an RSS link"
              spellCheck={false}
            />
            {isLink(query) ? (
              <button className="btn btn-sm btn-primary" type="submit" disabled={busy === "feed"}>
                {busy === "feed" ? "Reading the feed…" : "Add feed"}
              </button>
            ) : searching ? (
              <span style={{ fontSize: 12 }}>Searching…</span>
            ) : (
              <Kbd keys="/" />
            )}
          </label>
        </form>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {results ? (
          <section aria-label="Search results">
            <h2 className="eyebrow" style={{ marginBottom: 10 }}>
              {results.length ? `${results.length} shows` : "No shows found"}
            </h2>
            {results.length === 0 && <p className="muted">Try other words, or paste the show's RSS link.</p>}
            <ListingRows listings={results} busy={busy} onOpen={open} isSubscribed={isSubscribed} />
          </section>
        ) : (
          <>
            <YourShows shows={yours} onAddFeed={() => {
              setQuery("https://");
              input.current?.focus();
            }} />
            <Recommended country={country} onCountry={changeCountry} busy={busy} onOpen={open} isSubscribed={isSubscribed} />
          </>
        )}
      </div>
    </Page>
  );
}

function YourShows({ shows, onAddFeed }: { shows: Show[] | null; onAddFeed: () => void }) {
  const navigate = useNavigate();
  if (shows === null) return null;
  return (
    <section aria-labelledby="yours">
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 12 }}>
        <h2 id="yours" className="eyebrow" style={{ flexGrow: 1 }}>
          Your shows
        </h2>
        <span style={{ fontSize: 12 }}>{shows.length ? `${shows.length} subscribed` : "Subscribe to a show to keep it here"}</span>
      </div>
      <div className="tiles">
        {shows.map((s) => (
          <button key={s.id} type="button" className="tile" onClick={() => navigate(`/podcasts/show/${s.id}`)}>
            <Art url={s.artworkUrl} radius={10} />
            <span className="ell" style={{ font: "500 13px/1.3 var(--font-text)", color: "var(--ink)" }}>
              {s.title}
            </span>
            <span className="ell" style={{ fontSize: 12, marginTop: -4 }}>
              {s.newCount ? `${s.newCount} new` : s.author || " "}
            </span>
          </button>
        ))}
        <button type="button" className="tile" onClick={onAddFeed}>
          <span className="tile-add">
            <Icon name="plus" size={20} />
          </span>
          <span style={{ fontSize: 13 }}>Add an RSS feed</span>
        </button>
      </div>
    </section>
  );
}

function Recommended({
  country,
  onCountry,
  busy,
  onOpen,
  isSubscribed,
}: {
  country: string;
  onCountry: (c: string) => void;
  busy: string | null;
  onOpen: (l: Listing, subscribe?: boolean) => void;
  isSubscribed: (l: Listing) => boolean | "" | null;
}) {
  const [tab, setTab] = useState<Tab>(TABS[0]);
  const [list, setList] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    (tab.learners ? backend.forLearners() : backend.chart(country, tab.genre)).then(
      (l) => live && setList(l),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [tab, country]);

  const countryName = COUNTRIES.find(([c]) => c === country)?.[1] ?? country.toUpperCase();

  return (
    <section aria-labelledby="recommended">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 id="recommended" className="eyebrow">
          Recommended
        </h2>
        <div className="pills" role="group" aria-label="Recommendations">
          {TABS.map((t) => (
            <button key={t.key} type="button" className="pill" aria-pressed={t.key === tab.key} onClick={() => setTab(t)}>
              {t.key === "top" ? `Top in ${countryName}` : t.label}
            </button>
          ))}
        </div>
        <span style={{ flexGrow: 1 }} />
        {!tab.learners && (
          <select className="btn btn-sm" value={country} onChange={(e) => onCountry(e.target.value)} aria-label="Charts for country">
            {COUNTRIES.map(([c, name]) => (
              <option key={c} value={c}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>
      <p style={{ fontSize: 12, marginBottom: 8 }}>
        {tab.learners ? "Clear speech at a steady pace. Chosen by us." : `Apple Podcasts charts${tab.genre ? `, ${tab.label}` : ""}, ${countryName}.`}
      </p>
      {error && <div className="notice notice-error">{error}</div>}
      {list === null && !error && <p className="muted" style={{ padding: "12px 0" }}>Loading…</p>}
      {list && <ListingRows listings={list} busy={busy} onOpen={onOpen} isSubscribed={isSubscribed} numbered={!tab.learners} />}
    </section>
  );
}

function ListingRows({
  listings,
  busy,
  onOpen,
  isSubscribed,
  numbered = false,
}: {
  listings: Listing[];
  busy: string | null;
  onOpen: (l: Listing, subscribe?: boolean) => void;
  isSubscribed: (l: Listing) => boolean | "" | null;
  numbered?: boolean;
}) {
  const cols = numbered ? "24px 40px minmax(0,1fr) 110px" : "40px minmax(0,1fr) 110px";
  return (
    <div style={{ borderTop: "1px solid var(--hairline)" }} role="list">
      {listings.map((l, i) => {
        const key = l.appleId ?? l.feedUrl ?? l.title;
        const sub = isSubscribed(l);
        return (
          <div
            key={key}
            role="listitem"
            className="tr"
            tabIndex={0}
            style={{ gridTemplateColumns: cols, height: 60 }}
            onClick={() => onOpen(l)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onOpen(l);
            }}
          >
            {numbered && <span className="mono" style={{ fontSize: 12 }}>{i + 1}</span>}
            <Art url={l.artworkUrl} size={40} />
            <div style={{ minWidth: 0 }}>
              <div className="ell" style={{ fontWeight: 500, color: "var(--ink)" }}>
                {l.title}
              </div>
              <div className="ell" style={{ fontSize: 12, marginTop: 4 }}>
                {[l.author, l.note].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span style={{ textAlign: "right" }}>
              {busy === key ? (
                <span style={{ fontSize: 12 }}>Opening…</span>
              ) : sub ? (
                <span style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Icon name="check" size={14} stroke={2} />
                  Subscribed
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(l, true);
                  }}
                >
                  Subscribe
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

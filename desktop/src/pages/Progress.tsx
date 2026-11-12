// Progress (DESIGN.md, Progress): the streak, time this week, dictation accuracy, words known, a year of
// practice day by day, and accuracy week by week.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Page } from "../components/Shell";
import { backend, on, type Progress as Data } from "../lib/backend";

type DayDetail = Data["days"][number];
import { percent } from "../lib/dictation";
import { plural, practised } from "../lib/format";

const DAY = 86_400_000;
const dateOf = (day: string) => new Date(`${day}T12:00`);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const longDay = (day: string) => dateOf(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const shortDay = (day: string) => dateOf(day).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function useProgress(): Data | null {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    const load = () => backend.progress().then(setData, () => {});
    load();
    const offs = [on("practice", load), on("words", load)];
    return () => offs.forEach((off) => off());
  }, []);
  return data;
}

/** "up 6", "down 3", "same as last month"; points, not percent of percent. */
function change(now: number | null, before: number | null): string {
  if (now == null) return "no dictation yet";
  if (before == null) return "first month";
  const d = Math.round(now * 100) - Math.round(before * 100);
  return d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : "same as last month";
}

/** Total time, for the year grid's heading. */
function yearTotal(seconds: number): string {
  const h = seconds / 3600;
  if (h >= 10) return `${plural(Math.round(h), "hour")} in the last year`;
  if (h >= 1) return `${practised(seconds)} in the last year`;
  return `${plural(Math.round(seconds / 60), "minute")} in the last year`;
}

/** How dark a day's square is: 0 for nothing, then under 15 minutes, under 30, under an hour, an hour or more. */
function level(d: DayDetail | undefined): number {
  if (!d) return 0;
  const m = d.seconds / 60;
  if (m >= 60) return 4;
  if (m >= 30) return 3;
  if (m >= 15) return 2;
  return 1;
}

/** "Thu 12 Nov · 25 min". */
function describe(d: DayDetail | undefined, day: string): string {
  return `${longDay(day)} · ${d ? practised(d.seconds) : "0 min"}`;
}

function YearGrid({ data }: { data: Data }) {
  const byDay = new Map(data.days.map((d) => [d.day, d]));
  const start = dateOf(data.from).getTime();
  const today = iso(new Date());
  const cells = Array.from({ length: 53 * 7 }, (_, i) => iso(new Date(start + i * DAY)));
  // A month's name sits over the column holding its first day.
  const months: { col: number; name: string }[] = [];
  cells.forEach((day, i) => {
    if (day.endsWith("-01") && i / 7 < 51) months.push({ col: Math.floor(i / 7), name: dateOf(day).toLocaleDateString("en-GB", { month: "short" }) });
  });
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const shown = hover ?? pinned ?? today;
  const practisedDays = data.days.filter((d) => d.day >= data.from).length;

  return (
    <section className="panel" aria-labelledby="year" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h2 id="year" className="h2" style={{ flexGrow: 1 }}>
          {yearTotal(data.yearSeconds)}
        </h2>
        <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
          {describe(byDay.get(shown), shown)}
        </span>
      </div>
      <div className="year">
        <span />
        <div className="year-months mono" aria-hidden="true">
          {months.map((m) => (
            <span key={m.col} style={{ gridColumn: `${m.col + 1} / span 4` }}>
              {m.name}
            </span>
          ))}
        </div>
        <div className="year-weekdays mono" aria-hidden="true">
          <span>Mon</span>
          <span />
          <span>Wed</span>
          <span />
          <span>Fri</span>
          <span />
          <span>Sun</span>
        </div>
        <div
          className="year-days"
          role="img"
          aria-label={`Practice on ${plural(practisedDays, "day")} in the last year, ${practised(data.yearSeconds)} in all`}
          onMouseLeave={() => setHover(null)}
        >
          {cells.map((day) =>
            day > today ? (
              <span key={day} />
            ) : (
              <span
                key={day}
                className="year-day"
                data-level={level(byDay.get(day))}
                data-on={day === shown || undefined}
                onMouseEnter={() => setHover(day)}
                onClick={() => setPinned(day === pinned ? null : day)}
              />
            ),
          )}
        </div>
      </div>
      <div className="year-legend">
        <span style={{ flexGrow: 1 }}>Each square is a day. Darker means more minutes.</span>
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="year-day" data-level={l} aria-hidden="true" />
        ))}
        More
      </div>
    </section>
  );
}

/** Measures an element's width, for charts drawn in real pixels. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function AccuracyChart({ weeks }: { weeks: Data["weeks"] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 140;
  const top = 14;
  const bottom = 22;
  const left = 4;
  const right = 40;
  const values = weeks.map((w) => w.accuracy).filter((a): a is number => a != null);
  const lo = values.length ? Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10) : 0;
  const hi = values.length ? Math.min(1, Math.ceil((Math.max(...values) + 0.05) * 10) / 10) : 1;
  const x = (i: number) => left + (i * (width - left - right)) / Math.max(1, weeks.length - 1);
  const y = (a: number) => top + (1 - (a - lo) / Math.max(0.01, hi - lo)) * (H - top - bottom);
  const mid = Math.round(((lo + hi) / 2) * 20) / 20;
  // Weeks without dictation leave a gap in the line.
  const runs: string[] = [];
  let run: string[] = [];
  weeks.forEach((w, i) => {
    if (w.accuracy == null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
    } else run.push(`${x(i).toFixed(1)},${y(w.accuracy).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  const lastIndex = weeks.map((w) => w.accuracy != null).lastIndexOf(true);
  const shown = hover ?? (lastIndex >= 0 ? lastIndex : null);
  const first = values[0];
  const last = values[values.length - 1];

  return (
    <section className="panel" aria-labelledby="acc" style={{ padding: "18px 20px", flex: "1.3 1 360px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 id="acc" className="h2" style={{ flexGrow: 1 }}>
          Accuracy, last 12 weeks
        </h2>
        {shown != null && (
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">
            Week of {shortDay(weeks[shown].start)} ·{" "}
            {weeks[shown].accuracy == null ? "no dictation" : `${percent(weeks[shown].accuracy)} · ${plural(weeks[shown].sentences, "sentence")}`}
          </span>
        )}
      </div>
      <div ref={ref} style={{ position: "relative" }}>
        {values.length === 0 ? (
          <div className="muted" style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
            Dictate a few sentences and your accuracy shows here, week by week.
          </div>
        ) : (
          width > 0 && (
            <svg
              width={width}
              height={H}
              role="img"
              aria-label={values.length > 1 ? `Accuracy went from ${percent(first)} to ${percent(last)}` : `Accuracy ${percent(last)}`}
              onMouseLeave={() => setHover(null)}
              onMouseMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const i = Math.round(((e.clientX - r.left - left) / (width - left - right)) * (weeks.length - 1));
                setHover(Math.max(0, Math.min(weeks.length - 1, i)));
              }}
            >
              <line x1={0} x2={width} y1={H - bottom} y2={H - bottom} stroke="var(--hairline)" />
              <line x1={0} x2={width - right + 8} y1={y(mid)} y2={y(mid)} stroke="var(--hairline)" strokeDasharray="3 4" />
              <text x={width - right + 12} y={y(mid) + 4} fill="var(--ink-subtle)" fontSize={11} fontFamily="var(--font-mono)">
                {percent(mid)}
              </text>
              {shown != null && hover != null && (
                <line x1={x(shown)} x2={x(shown)} y1={top - 6} y2={H - bottom} stroke="var(--hairline-strong)" />
              )}
              {runs.map((pts, i) =>
                pts.includes(" ") ? (
                  <polyline key={i} points={pts} fill="none" stroke="var(--ink-muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ) : (
                  <circle key={i} cx={pts.split(",")[0]} cy={pts.split(",")[1]} r={3} fill="var(--ink-muted)" />
                ),
              )}
              {shown != null && weeks[shown].accuracy != null && (
                <circle cx={x(shown)} cy={y(weeks[shown].accuracy!)} r={4.5} fill="var(--ink)" stroke="var(--surface-1)" strokeWidth={2} />
              )}
              {[0, weeks.length - 1].map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={H - 6}
                  textAnchor={i === 0 ? "start" : "end"}
                  fill="var(--ink-subtle)"
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                >
                  {i === weeks.length - 1 ? "This week" : shortDay(weeks[i].start)}
                </text>
              ))}
            </svg>
          )
        )}
      </div>
    </section>
  );
}

export function Progress() {
  const data = useProgress();
  return (
    <Page crumbs={["Progress"]}>
      <div className="page" style={{ gap: 22 }}>
        <h1 className="h1">Progress</h1>
        <div className="cells progress-cells">
          <div className="cell">
            <div className="big">{data ? plural(data.streak, "day") : "—"}</div>
            <div className="small">Current streak{data ? ` · best ${data.bestStreak}` : ""}</div>
          </div>
          <div className="cell">
            <div className="big">{data ? practised(data.weekSeconds) : "—"}</div>
            <div className="small">This week</div>
          </div>
          <div className="cell">
            <div className="big">{data ? percent(data.monthAccuracy) : "—"}</div>
            <div className="small">Accuracy this month{data ? ` · ${change(data.monthAccuracy, data.lastMonthAccuracy)}` : ""}</div>
          </div>
          <div className="cell">
            <div className="big">
              {data ? data.wordsKnown : "—"}
              {data && (
                <span style={{ fontSize: 14, color: "var(--ink-subtle)", fontWeight: 500 }}> / {data.wordsTotal}</span>
              )}
            </div>
            <div className="small">Words known</div>
          </div>
        </div>

        {data && <YearGrid data={data} />}

        {data && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <AccuracyChart weeks={data.weeks} />
            <section className="panel" aria-labelledby="miss" style={{ padding: "18px 20px", flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <h2 id="miss" className="h2" style={{ flexGrow: 1 }}>
                  What you mishear most
                </h2>
                <span className="badge badge-next">Later</span>
              </div>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                Small words like <i>to</i> and <i>of</i>, words that run together, numbers: once mistakes are sorted by kind,
                the ones you miss most will show here.
              </p>
            </section>
          </div>
        )}
      </div>
    </Page>
  );
}

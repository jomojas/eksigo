// The playback settings for dictation, the same in the Dictation side panel and in Settings.
// Changes apply at once and become the defaults.

import { clampSpeed, PAUSE_FACTORS, PLAYS_MAX, SPEED_MAX, SPEED_MIN, SPEED_STEP, speedLabel, type DictationSettings } from "../lib/dictation";
import { Kbd } from "./Shell";

type Props = { settings: DictationSettings; update: (c: Partial<DictationSettings>) => void; onSpeed?: (s: number) => void };

function Stepper({ value, label, onDown, onUp, downOff, upOff }: { value: string; label: string; onDown: () => void; onUp: () => void; downOff: boolean; upOff: boolean }) {
  return (
    <span className="seg" role="group" aria-label={label}>
      <button type="button" onClick={onDown} disabled={downOff} aria-label={`Less ${label.toLowerCase()}`}>
        −
      </button>
      <button type="button" aria-pressed="true" className="mono" tabIndex={-1} style={{ minWidth: 44, justifyContent: "center" }}>
        {value}
      </button>
      <button type="button" onClick={onUp} disabled={upOff} aria-label={`More ${label.toLowerCase()}`}>
        +
      </button>
    </span>
  );
}

export function SpeedSlider({ speed, onSpeed }: { speed: number; onSpeed: (s: number) => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
      <input
        className="scrub"
        type="range"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={SPEED_STEP}
        value={speed}
        onChange={(e) => onSpeed(clampSpeed(Number(e.target.value)))}
        aria-label="Speed"
        aria-valuetext={speedLabel(speed)}
        style={{ width: 110, background: `linear-gradient(to right, var(--ink-muted) ${((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%, var(--hairline) 0)` }}
      />
      <span className="mono" style={{ width: 42, textAlign: "right", color: "var(--ink)", fontSize: 12 }}>
        {speedLabel(speed)}
      </span>
    </span>
  );
}

export function PlaybackSettings({ settings: s, update, onSpeed }: Props) {
  const auto = s.mode === "auto";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="prop">
        Mode
        <span className="seg" role="group" aria-label="Mode" style={{ marginLeft: "auto" }}>
          <button type="button" aria-pressed={!auto} onClick={() => update({ mode: "manual" })} title="Each sentence plays when you press Tab">
            Manual
          </button>
          <button type="button" aria-pressed={auto} onClick={() => update({ mode: "auto" })} title="Each sentence plays the maximum number of times in a row">
            Auto
          </button>
        </span>
      </div>
      <div className="prop">
        Speed
        <SpeedSlider speed={s.speed} onSpeed={onSpeed ?? ((v) => update({ speed: v }))} />
      </div>
      <div className="prop" style={{ fontSize: 12, minHeight: 0, marginTop: -4 }}>
        <span style={{ marginLeft: "auto" }}>
          <Kbd keys="Mod −" /> <Kbd keys="Mod =" /> by 0.05 · <Kbd keys="Mod 0" /> resets
        </span>
      </div>
      <div className="prop">
        Max plays
        <span style={{ marginLeft: "auto" }}>
          <Stepper
            label="Plays"
            value={String(s.maxPlays)}
            onDown={() => update({ maxPlays: s.maxPlays - 1 })}
            onUp={() => update({ maxPlays: s.maxPlays + 1 })}
            downOff={s.maxPlays <= 1}
            upOff={s.maxPlays >= PLAYS_MAX}
          />
        </span>
      </div>
      <div className="prop" style={{ flexWrap: "wrap", rowGap: 6, ...(auto ? {} : { color: "var(--ink-tertiary)" }) }}>
        Pause between plays
        {auto ? (
          <span className="seg" role="group" aria-label="Pause" style={{ marginLeft: "auto" }}>
            <button type="button" aria-pressed={s.pauseKind === "relative"} onClick={() => update({ pauseKind: "relative" })} title="As long as the sentence, times this">
              Sentence
            </button>
            <button type="button" aria-pressed={s.pauseKind === "fixed"} onClick={() => update({ pauseKind: "fixed" })} title="A fixed number of seconds">
              Seconds
            </button>
          </span>
        ) : (
          <b style={{ color: "var(--ink-tertiary)", fontWeight: 400 }}>Auto only</b>
        )}
      </div>
      {auto && (
        <div className="prop">
          <span>{s.pauseKind === "relative" ? "Sentence length ×" : "Seconds"}</span>
          <span style={{ marginLeft: "auto" }}>
            {s.pauseKind === "relative" ? (
              <span className="seg" role="group" aria-label="Pause length">
                {PAUSE_FACTORS.map((f) => (
                  <button key={f} type="button" aria-pressed={s.pauseFactor === f} onClick={() => update({ pauseFactor: f })}>
                    {f}×
                  </button>
                ))}
              </span>
            ) : (
              <Stepper
                label="Seconds"
                value={`${s.pauseSeconds} s`}
                onDown={() => update({ pauseSeconds: s.pauseSeconds - 1 })}
                onUp={() => update({ pauseSeconds: s.pauseSeconds + 1 })}
                downOff={s.pauseSeconds <= 1}
                upOff={s.pauseSeconds >= 10}
              />
            )}
          </span>
        </div>
      )}
      <div className="prop">
        <span>
          Slower <Kbd keys="Mod R" />
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Stepper
            label="Slow speed"
            value={speedLabel(s.slowSpeed)}
            onDown={() => update({ slowSpeed: clampSpeed(s.slowSpeed - SPEED_STEP) })}
            onUp={() => update({ slowSpeed: clampSpeed(s.slowSpeed + SPEED_STEP) })}
            downOff={s.slowSpeed <= SPEED_MIN + 0.001}
            upOff={s.slowSpeed >= 0.95}
          />
        </span>
      </div>
    </div>
  );
}

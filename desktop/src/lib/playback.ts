// Playing audio from the interface: one player for the whole app, in the Rust core.

import { useCallback, useEffect, useRef, useState } from "react";
import { backend, on, type Sentence } from "./backend";

/** Slowest first, like a dial. 1.25× is for when an episode feels easy. */
export const SPEEDS = [0.7, 0.85, 1, 1.25] as const;

let nextId = 1;
/** The playback the interface last asked for; events from older ones are ignored. */
let current = 0;

export type PlayState = { playing: boolean; positionMs: number; error: string | null };

/** Plays stretches of one file. Stops when the component using it goes away. */
export function usePlayer(path: string | null) {
  const [state, setState] = useState<PlayState>({ playing: false, positionMs: 0, error: null });
  const mine = useRef(0);

  useEffect(
    () =>
      on("playback", (e) => {
        if (e.id !== mine.current || e.id !== current) return;
        setState({ playing: e.playing, positionMs: e.positionMs, error: e.error });
      }),
    [],
  );

  useEffect(
    () => () => {
      if (mine.current === current && mine.current !== 0) backend.stopPlayback();
    },
    [],
  );

  const play = useCallback(
    (startMs: number, endMs: number | null, speed: number) => {
      if (!path) return;
      const id = nextId++;
      mine.current = id;
      current = id;
      setState({ playing: true, positionMs: startMs, error: null });
      backend.play({ id, path, startMs: Math.max(0, Math.round(startMs)), endMs: endMs === null ? null : Math.round(endMs), speed }).catch((e) =>
        setState({ playing: false, positionMs: startMs, error: String(e) }),
      );
    },
    [path],
  );

  const stop = useCallback(() => {
    if (mine.current === current) backend.stopPlayback();
    setState((s) => ({ ...s, playing: false }));
  }, []);

  return { ...state, play, stop };
}

/** Where `ms` is in the transcript: the last sentence starting at or before it, or -1. */
export function sentenceAt(sentences: Sentence[], ms: number): number {
  let lo = 0;
  let hi = sentences.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Past the last sentence written so far (the transcript is still growing): no sentence.
  if (found === sentences.length - 1 && found >= 0 && ms > sentences[found].endMs + 2000) return -1;
  return found;
}

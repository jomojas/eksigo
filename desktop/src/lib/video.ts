// Videos from the learner's own files (MP4, MOV, M4V): the picture plays in the window, from a <video>
// element, instead of through the Rust player. The sound is the same file, so its transcript is the usual one.

import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { backend, inApp, type Item } from "./backend";
import type { PlayState } from "./playback";

const VIDEO = /\.(mp4|m4v|mov)$/i;

export const isVideo = (item: Pick<Item, "ownFile" | "path"> | null | undefined) => !!item?.ownFile && !!item.path && VIDEO.test(item.path);

export const isVideoPath = (path: string | null | undefined) => !!path && VIDEO.test(path);

/** The address the window plays a Library video from, once the Rust side has allowed that one file. */
export function useVideoSrc(itemId: number, on: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    backend.videoOpen(itemId).then(
      (path) => live && setSrc(inApp ? convertFileSrc(path) : path),
      () => live && setSrc(null),
    );
    return () => {
      live = false;
    };
  }, [itemId, on]);
  return src;
}

/** Plays a <video> element with the same calls as `usePlayer`, so a page can use either. */
export function useVideoPlayer(v: HTMLVideoElement | null) {
  const [state, setState] = useState<PlayState>({ playing: false, positionMs: 0, error: null });
  const end = useRef<number | null>(null);

  useEffect(() => {
    if (!v) return;
    let frame = 0;
    // The position is read every frame while playing, so the subtitle changes with the voice, not up to
    // a quarter of a second later as `timeupdate` would.
    const tick = () => {
      const ms = v.currentTime * 1000;
      if (end.current !== null && ms >= end.current) {
        end.current = null;
        v.pause();
      }
      // About 20 times a second is enough for the subtitle and keeps a long transcript light to redraw.
      setState((s) => (Math.abs(s.positionMs - ms) < 50 && s.playing === !v.paused ? s : { ...s, positionMs: ms, playing: !v.paused }));
      if (!v.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onStop = () => {
      cancelAnimationFrame(frame);
      setState((s) => ({ ...s, playing: false, positionMs: v.currentTime * 1000 }));
    };
    const onError = () => setState((s) => ({ ...s, playing: false, error: "This video can't be played on this computer." }));
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onStop);
    v.addEventListener("ended", onStop);
    v.addEventListener("seeked", tick);
    v.addEventListener("error", onError);
    return () => {
      cancelAnimationFrame(frame);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onStop);
      v.removeEventListener("ended", onStop);
      v.removeEventListener("seeked", tick);
      v.removeEventListener("error", onError);
    };
  }, [v]);

  const play = useCallback(
    (startMs: number, endMs: number | null, speed: number) => {
      if (!v) return;
      // A clip of a word may be playing through the Rust player; the video takes over.
      backend.stopPlayback().catch(() => {});
      end.current = endMs;
      v.currentTime = Math.max(0, startMs) / 1000;
      v.playbackRate = speed;
      v.preservesPitch = true;
      setState({ playing: true, positionMs: startMs, error: null });
      v.play().catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ playing: false, positionMs: startMs, error: "This video can't be played on this computer." });
      });
    },
    [v],
  );

  const stop = useCallback(() => {
    v?.pause();
    setState((s) => ({ ...s, playing: false }));
  }, [v]);

  return { ...state, play, stop };
}

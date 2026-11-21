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

// ---------- thumbnails ----------

/** Wide enough to stand in for the video on Watch before it plays. */
const THUMB_WIDTH = 640;
/** Videos tried this session; one that fails isn't tried again until the app restarts. */
const tried = new Set<number>();

/** Gives a Library video its thumbnail: the cover picture stored in the file, or else a frame near the start
 * (a second in, since many videos open on black; further in if that frame is still dark). */
export async function makeThumbnail(itemId: number): Promise<void> {
  if (tried.has(itemId)) return;
  tried.add(itemId);
  try {
    const cover = await backend.videoCover(itemId);
    let url = cover ? await fromImage(cover) : null;
    if (!url) {
      const path = await backend.videoOpen(itemId);
      url = await fromVideo(inApp ? convertFileSrc(path) : path);
    }
    if (url) await backend.saveThumbnail(itemId, url);
  } catch {
    // No thumbnail: the Library shows the video icon instead.
  }
}

/** Thumbnails for the Library videos that have none, one at a time. */
export async function makeThumbnails(items: Item[]) {
  for (const it of items) {
    if (isVideo(it) && it.state === "ready" && !it.artworkUrl) await makeThumbnail(it.id);
  }
}

function draw(source: CanvasImageSource, w: number, h: number): { url: string; dark: boolean } | null {
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(THUMB_WIDTH, w);
  canvas.height = Math.round((canvas.width * h) / w);
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  // How dark the frame is, from a coarse sample of its pixels.
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4 * 97) {
    sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    n++;
  }
  return { url: canvas.toDataURL("image/jpeg", 0.8), dark: n > 0 && sum / n < 18 };
}

function fromImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(draw(img, img.naturalWidth, img.naturalHeight)?.url ?? null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fromVideo(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    // The file is served from another origin; this lets its pixels be read.
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.preload = "auto";
    let later = false;
    const finish = (url: string | null) => {
      window.clearTimeout(timer);
      v.removeAttribute("src");
      v.load();
      resolve(url);
    };
    const timer = window.setTimeout(() => finish(null), 20_000);
    v.onloadeddata = () => {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onseeked = () => {
      const frame = draw(v, v.videoWidth, v.videoHeight);
      if (frame?.dark && !later && v.duration > 10) {
        later = true;
        v.currentTime = v.duration * 0.1;
        return;
      }
      finish(frame?.url ?? null);
    };
    v.onerror = () => finish(null);
    v.src = src;
  });
}

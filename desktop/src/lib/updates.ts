// Updates: the app looks for a newer release once per run, downloads it without asking, and offers to restart
// into it. Releases are signed; the updater refuses one whose signature doesn't match the key built into the app.

import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { inApp } from "./backend";

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current" }
  | { state: "downloading"; version: string; fraction: number | null }
  | { state: "ready"; version: string }
  | { state: "failed"; error: string };

let current: UpdateState = { state: "idle" };
let ready: Update | null = null;
const subscribers = new Set<(s: UpdateState) => void>();

function set(s: UpdateState) {
  current = s;
  subscribers.forEach((f) => f(s));
}

/** Looks for an update and downloads it. Does nothing while a check or download is under way, or once one is ready. */
export async function checkForUpdate() {
  if (!inApp || ["checking", "downloading", "ready"].includes(current.state)) return;
  set({ state: "checking" });
  try {
    const update = await check();
    if (!update) return set({ state: "current" });
    let total: number | null = null;
    let received = 0;
    set({ state: "downloading", version: update.version, fraction: null });
    await update.download((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? null;
      else if (e.event === "Progress") {
        received += e.data.chunkLength;
        set({ state: "downloading", version: update.version, fraction: total ? received / total : null });
      }
    });
    ready = update;
    set({ state: "ready", version: update.version });
  } catch (e) {
    set({ state: "failed", error: String(e) });
  }
}

/** Installs the downloaded update and starts the new version. */
export async function restartToUpdate() {
  if (!ready) return;
  await ready.install();
  await relaunch();
}

let checkedThisRun = false;

/** The update state, checking once per run of the app. */
export function useUpdate(): UpdateState {
  const [s, setS] = useState(current);
  useEffect(() => {
    subscribers.add(setS);
    if (!checkedThisRun) {
      checkedThisRun = true;
      checkForUpdate();
    }
    return () => {
      subscribers.delete(setS);
    };
  }, []);
  return s;
}

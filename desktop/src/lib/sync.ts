// Sync with the account (sync.rs, design D20): one state for the whole app, so the sidebar and Settings agree.

import { useEffect, useState } from "react";
import { backend, on, type SyncStatus } from "./backend";

let current: SyncStatus | null = null;
const subscribers = new Set<(s: SyncStatus | null) => void>();
let started = false;

function set(s: SyncStatus) {
  current = s;
  subscribers.forEach((f) => f(s));
}

function start() {
  if (started) return;
  started = true;
  on("sync", set);
  // Signing in or out changes what the sync says.
  on("account", () => backend.syncStatus().then(set, () => {}));
  backend.syncStatus().then(set, () => {});
}

export function useSync(): SyncStatus | null {
  const [state, setState] = useState(current);
  useEffect(() => {
    start();
    subscribers.add(setState);
    setState(current);
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}

export const syncNow = () => backend.syncNow().then(set);

/** "just now", "2 minutes ago", "today, 21:40", "yesterday, 21:40", "10 Nov, 21:40". */
export function syncedAgo(ms: number, now = Date.now()): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return min === 1 ? "1 minute ago" : `${min} minutes ago`;
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(new Date(now).toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

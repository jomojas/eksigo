// AI (DESIGN.md section 6, designs D16–D18): what is connected, and connecting ChatGPT through the browser.
// One state for the whole app, so Settings, the lookup card and the review always agree.

import { useEffect, useState } from "react";
import { aiProblem, backend, on, type AiKey, type AiProblem, type AiStatus } from "./backend";

export type AiState = {
  /** undefined until read. */
  status: AiStatus | undefined;
  /** OpenAI's page is open in the browser. */
  waiting: boolean;
  error: string | null;
};

let current: AiState = { status: undefined, waiting: false, error: null };
const subscribers = new Set<(s: AiState) => void>();
let started = false;

function set(s: Partial<AiState>) {
  current = { ...current, ...s };
  subscribers.forEach((f) => f(current));
}

function start() {
  if (started) return;
  started = true;
  on("ai", (status) => set({ status }));
  backend.aiStatus().then(
    (status) => set({ status }),
    () => set({ status: { using: null, chatgpt: null, key: null } }),
  );
}

export function useAi(): AiState {
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

/** Counts connections: only the latest one speaks (a replaced one comes back cancelled). */
let attempt = 0;

export async function connectChatGpt() {
  const mine = ++attempt;
  set({ waiting: true, error: null });
  try {
    const status = await backend.aiConnect();
    if (mine === attempt) set({ waiting: false, ...(status ? { status } : {}) });
  } catch (e) {
    if (mine === attempt) set({ waiting: false, error: String(e) });
  }
}

export function cancelConnect() {
  attempt++;
  set({ waiting: false });
  backend.aiCancel().catch(() => {});
}

export async function disconnectChatGpt() {
  set({ error: null });
  set({ status: await backend.aiDisconnect() });
}

/** Tries the key and keeps it when it works; throws the sentence to show otherwise. */
export async function saveKey(key: AiKey, secret: string) {
  try {
    set({ status: await backend.aiSetKey(key, secret) });
  } catch (e) {
    throw new Error(problemText(aiProblem(e)));
  }
}

export async function removeKey() {
  set({ status: await backend.aiRemoveKey() });
}

/** One sentence for a problem that has no button of its own. */
export function problemText(p: AiProblem): string {
  switch (p.kind) {
    case "notSetUp":
      return "AI isn't set up yet. Connect ChatGPT or add a key in Settings › AI.";
    case "limit":
      return "You've used this week's ChatGPT limit for Eksigo. Raise it in ChatGPT, or wait until it resets.";
    case "reconnect":
      return "ChatGPT needs connecting again, in Settings › AI.";
    default:
      return p.message ?? "The AI couldn't answer. Try again.";
  }
}

export const SETTINGS_AI = "/settings?s=ai";

// AI (DESIGN.md section 6, designs D16–D19): what is connected, and connecting ChatGPT through the browser.
// One state for the whole app, so Settings, the lookup card and the review always agree.

import { useEffect, useState } from "react";
import { aiProblem, backend, on, type AiKey, type AiProblem, type AiStatus, type SavedWord } from "./backend";

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

/** Picks the model (null: Eksigo picks a small one). */
export async function setModel(model: string | null) {
  set({ status: await backend.aiSetModel(model) });
}

const plain = (w: string) => w.replace(/’/g, "'").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Adds a word the AI named (a new word in *Why did I miss this?* or the episode review) to My words, with its
 * sentence: the dictionary's meaning when it has one, else the AI's; the AI's explanation goes with it. */
export async function saveWordFrom(
  lang: string,
  w: { itemId: number; idx: number; sentence: string; typed: string; text: string; meaning: string; explanation: string },
): Promise<SavedWord> {
  const words = w.sentence.split(/\s+/).filter(Boolean).map(plain);
  const want = w.text.split(/\s+/).filter(Boolean).map(plain);
  let from = words.findIndex((_, i) => want.length > 0 && want.every((x, k) => words[i + k] === x));
  if (from < 0) from = 0;
  const found = await backend.lookup(lang, w.text).catch(() => null);
  const entry = found?.whole ? found.entry : null;
  return backend.addWord({
    text: found?.query || w.text,
    headword: entry?.headword ?? "",
    ipa: entry?.ipa ?? "",
    meaning: entry?.meaning ?? w.meaning,
    note: "",
    explanation: w.explanation,
    itemId: w.itemId,
    idx: w.idx,
    from,
    to: Math.min(from + Math.max(want.length, 1) - 1, Math.max(words.length - 1, 0)),
    typed: w.typed,
  });
}

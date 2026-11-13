// The optional account (DESIGN.md section 8, design D14): who is signed in, and signing in through the browser.
// One state for the whole app, so the sidebar and Settings always agree.

import { useEffect, useState } from "react";
import { backend, on, type Account, type Provider } from "./backend";

export type AccountState = {
  /** undefined until the stored account has been read. */
  account: Account | null | undefined;
  /** The provider whose sign-in page is open in the browser. */
  waiting: Provider | null;
  error: string | null;
};

let current: AccountState = { account: undefined, waiting: null, error: null };
const subscribers = new Set<(s: AccountState) => void>();
let started = false;

function set(s: Partial<AccountState>) {
  current = { ...current, ...s };
  subscribers.forEach((f) => f(current));
}

/** Read the stored account at once, then ask the server once per run (a session ended elsewhere signs out here). */
function start() {
  if (started) return;
  started = true;
  on("account", (account) => set({ account }));
  backend.account().then(
    (account) => {
      set({ account });
      if (account) backend.refreshAccount().catch(() => {});
    },
    () => set({ account: null }),
  );
}

export function useAccount(): AccountState {
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

/** Counts sign-ins: only the latest one speaks (a replaced one comes back cancelled). */
let attempt = 0;

export async function signIn(provider: Provider) {
  const mine = ++attempt;
  set({ waiting: provider, error: null });
  try {
    const account = await backend.signIn(provider);
    if (mine === attempt) set({ waiting: null, ...(account ? { account } : {}) });
  } catch (e) {
    if (mine === attempt) set({ waiting: null, error: String(e) });
  }
}

export function cancelSignIn() {
  attempt++;
  set({ waiting: null });
  backend.cancelSignIn().catch(() => {});
}

export async function signOut() {
  set({ error: null });
  await backend.signOut();
  set({ account: null });
}

/** Throws with a sentence to show when the server couldn't delete it. */
export async function deleteAccount() {
  set({ error: null });
  await backend.deleteAccount();
  set({ account: null });
}

export const providerName = (p: string) => (p === "apple" ? "Apple" : p === "google" ? "Google" : "a developer sign-in");

/** The name to show: the name, else the e-mail, else a stand-in (Apple may share neither). */
export const displayName = (a: Account) => a.name || a.email?.split("@")[0] || "Your account";

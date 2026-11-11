// Transcription progress for the whole app: the status bar, the Library and the Episode page all read it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { on, type ModelProgress, type TranscriptStatus } from "./backend";

type Activity = { transcripts: Map<number, TranscriptStatus>; model: ModelProgress | null };

const Ctx = createContext<Activity>({ transcripts: new Map(), model: null });

export function TranscriptsProvider({ children }: { children: ReactNode }) {
  const [transcripts, setTranscripts] = useState(new Map<number, TranscriptStatus>());
  const [model, setModel] = useState<ModelProgress | null>(null);

  useEffect(() => {
    const offT = on("transcript", (s) => setTranscripts((m) => new Map(m).set(s.itemId, s)));
    const offM = on("model-download", (p) => setModel(p.state === "downloading" ? p : null));
    return () => {
      offT();
      offM();
    };
  }, []);

  return <Ctx.Provider value={{ transcripts, model }}>{children}</Ctx.Provider>;
}

export const useActivity = () => useContext(Ctx);

/** The latest status of one item's transcript, from events, or `initial` until one arrives. */
export function useTranscript(itemId: number | null, initial: TranscriptStatus | null): TranscriptStatus | null {
  const live = useContext(Ctx).transcripts.get(itemId ?? -1);
  return live ?? initial;
}

/** 0–1 of the audio transcribed. */
export function transcribed(s: Pick<TranscriptStatus, "state" | "doneMs" | "durationMs"> | null): number {
  if (!s) return 0;
  if (s.state === "done") return 1;
  return s.durationMs ? Math.min(1, s.doneMs / s.durationMs) : 0;
}

export const isBusy = (state: string | undefined | null) => state === "queued" || state === "model" || state === "running";

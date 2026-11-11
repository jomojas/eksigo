// Download progress for the whole app: the Library, the Show and Episode pages and the status bar all read it.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { on, type DownloadProgress } from "./backend";

const Ctx = createContext<Map<number, DownloadProgress>>(new Map());

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState(new Map<number, DownloadProgress>());

  useEffect(() => {
    const offProgress = on("download", (p) => setProgress((m) => new Map(m).set(p.itemId, p)));
    // When the Library changes, finished or cancelled downloads drop out of the list; the pages reload.
    const offLibrary = on("library", () =>
      setProgress((m) => {
        const next = new Map(m);
        for (const [id, p] of next) if (p.total !== null && p.received >= p.total) next.delete(id);
        return next;
      }),
    );
    return () => {
      offProgress();
      offLibrary();
    };
  }, []);

  return <Ctx.Provider value={progress}>{children}</Ctx.Provider>;
}

export const useDownloads = () => useContext(Ctx);

/** 0–1, or null while the size is unknown. */
export function fraction(p: DownloadProgress | undefined): number | null {
  if (!p || !p.total) return null;
  return Math.min(1, p.received / p.total);
}

/** Reloads whatever a page shows when the Library changes. */
export function useLibraryChanged(reload: () => void) {
  useEffect(() => on("library", reload), [reload]);
}

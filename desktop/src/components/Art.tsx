import { useState } from "react";
import { artUrl } from "../lib/backend";
import { Icon } from "./Icon";

/** A show's cover through our art server, then straight from its host, then a plain square. */
export function Art({ url, size, radius = 6, file = false }: { url: string | null; size?: number; radius?: number; file?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const src = attempt === 0 ? artUrl(url) : attempt === 1 ? url : null;
  const style = { width: size, height: size, borderRadius: radius, ...(size ? {} : { width: "100%", aspectRatio: "1" }) };
  if (file || !src) {
    return (
      <div className="art" style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-subtle)", background: "var(--surface-2)" }} aria-hidden="true">
        {file && <Icon name="file" size={Math.min(20, Math.round((size ?? 40) / 2))} />}
      </div>
    );
  }
  return <img className="art" src={src} alt="" loading="lazy" draggable={false} style={style} onError={() => setAttempt((a) => a + 1)} />;
}

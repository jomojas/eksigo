import { useState } from "react";
import { artUrl } from "../lib/backend";
import { Icon } from "./Icon";

/** A show's cover through our art server, then straight from its host, then a plain square. */
export function Art({ url, size, radius = 6, file = false, video = false }: { url: string | null; size?: number; radius?: number; file?: boolean; video?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const src = attempt === 0 ? artUrl(url) : attempt === 1 ? url : null;
  const style = { width: size, height: size, borderRadius: radius, ...(size ? {} : { width: "100%", aspectRatio: "1" }) };
  // An own file has no cover, except a video's thumbnail.
  if (!src || (file && !src.startsWith("data:"))) {
    return (
      <div className="art" style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-subtle)", background: "var(--surface-2)" }} aria-hidden="true">
        {file && <Icon name={video ? "video" : "file"} size={Math.min(20, Math.round((size ?? 40) / 2))} />}
      </div>
    );
  }
  return <img className="art" src={src} alt="" loading="lazy" draggable={false} style={{ ...style, objectFit: "cover" }} onError={() => setAttempt((a) => a + 1)} />;
}

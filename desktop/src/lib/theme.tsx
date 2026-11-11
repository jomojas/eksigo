import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { backend } from "./backend";

export type ThemeChoice = "system" | "light" | "dark";

const ThemeContext = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({
  choice: "system",
  setChoice: () => {},
});

const media = window.matchMedia("(prefers-color-scheme: light)");

function apply(choice: ThemeChoice) {
  const resolved = choice === "system" ? (media.matches ? "light" : "dark") : choice;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");

  useEffect(() => {
    backend.getSetting("theme").then((v) => {
      if (v === "light" || v === "dark" || v === "system") setChoiceState(v);
    });
  }, []);

  useEffect(() => {
    apply(choice);
    if (choice !== "system") return;
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  const setChoice = (c: ThemeChoice) => {
    setChoiceState(c);
    backend.setSetting("theme", c);
  };

  return <ThemeContext.Provider value={{ choice, setChoice }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

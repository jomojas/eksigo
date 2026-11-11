import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, Navigate, RouterProvider } from "react-router";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { Shell } from "./components/Shell";
import { ThemeProvider } from "./lib/theme";
import { Library, Podcasts, Progress, Today, Words } from "./pages/Placeholders";
import { Settings } from "./pages/Settings";

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: "today", element: <Today /> },
      { path: "podcasts", element: <Podcasts /> },
      { path: "library", element: <Library /> },
      { path: "words", element: <Words /> },
      { path: "progress", element: <Progress /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </React.StrictMode>,
);

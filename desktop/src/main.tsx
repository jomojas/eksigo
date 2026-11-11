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
import { DownloadsProvider } from "./lib/downloads";
import { ThemeProvider } from "./lib/theme";
import { EpisodeScreen } from "./pages/Episode";
import { Library } from "./pages/Library";
import { Progress, Today, Words } from "./pages/Placeholders";
import { Podcasts } from "./pages/Podcasts";
import { Settings } from "./pages/Settings";
import { ShowScreen } from "./pages/Show";

const router = createHashRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      { path: "today", element: <Today /> },
      { path: "podcasts", element: <Podcasts /> },
      { path: "podcasts/show/:showId", element: <ShowScreen /> },
      { path: "podcasts/episode/:episodeId", element: <EpisodeScreen from="podcasts" /> },
      { path: "library", element: <Library /> },
      { path: "library/:itemId", element: <EpisodeScreen from="library" /> },
      { path: "words", element: <Words /> },
      { path: "progress", element: <Progress /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <DownloadsProvider>
        <RouterProvider router={router} />
      </DownloadsProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
